// Communication notifications (macOS 12+): an agent's message posted as an incoming
// INSendMessageIntent, so Notification Center shows the agent's picture with a small app
// badge, as Messages does. Needs com.apple.developer.usernotifications.communication.

#import <Foundation/Foundation.h>
#import <Intents/Intents.h>
#import <Security/Security.h>
#import <UserNotifications/UserNotifications.h>
#include <node_api.h>

static NSString *const kChatKey = @"otterChat";
static NSString *const kReplyAction = @"OTTER_REPLY";
static NSString *const kActionPrefix = @"OTTER_ACTION_";

static napi_threadsafe_function responseCallback;

typedef struct {
  char *id;
  char *chat;
  int action;
  char *reply;
} Response;

static char *Copy(NSString *string) { return string ? strdup(string.UTF8String) : NULL; }

// Electron is the notification center's delegate and ignores responses to notifications it
// didn't post. This sits in front of it: responses to ours go to JS, the rest to Electron.
@interface OtterNotificationDelegate : NSObject <UNUserNotificationCenterDelegate>
@property(nonatomic, weak) id<UNUserNotificationCenterDelegate> next;
@end

@implementation OtterNotificationDelegate
- (BOOL)respondsToSelector:(SEL)selector {
  return [super respondsToSelector:selector] || [self.next respondsToSelector:selector];
}
- (id)forwardingTargetForSelector:(SEL)selector {
  return self.next;
}
- (void)userNotificationCenter:(UNUserNotificationCenter *)center
       willPresentNotification:(UNNotification *)notification
         withCompletionHandler:(void (^)(UNNotificationPresentationOptions))completionHandler {
  if ([self.next respondsToSelector:_cmd]) {
    [self.next userNotificationCenter:center
              willPresentNotification:notification
                withCompletionHandler:completionHandler];
  } else {
    completionHandler(UNNotificationPresentationOptionList | UNNotificationPresentationOptionBanner |
                      UNNotificationPresentationOptionSound);
  }
}
- (void)userNotificationCenter:(UNUserNotificationCenter *)center
    didReceiveNotificationResponse:(UNNotificationResponse *)response
             withCompletionHandler:(void (^)(void))completionHandler {
  UNNotificationRequest *request = response.notification.request;
  NSString *chat = request.content.userInfo[kChatKey];
  if (!chat) {
    if ([self.next respondsToSelector:_cmd]) {
      [self.next userNotificationCenter:center
          didReceiveNotificationResponse:response
                   withCompletionHandler:completionHandler];
    } else {
      completionHandler();
    }
    return;
  }
  NSString *identifier = response.actionIdentifier;
  Response *done = calloc(1, sizeof(Response));
  done->id = Copy(request.identifier);
  done->chat = Copy(chat);
  done->action = -1;
  if ([response isKindOfClass:UNTextInputNotificationResponse.class]) {
    done->reply = Copy(((UNTextInputNotificationResponse *)response).userText);
  } else if ([identifier hasPrefix:kActionPrefix]) {
    done->action = [identifier substringFromIndex:kActionPrefix.length].intValue;
  } else if (![identifier isEqualToString:UNNotificationDefaultActionIdentifier]) {
    free(done->id);
    free(done->chat);
    free(done);
    completionHandler();
    return;
  }
  if (!responseCallback ||
      napi_call_threadsafe_function(responseCallback, done, napi_tsfn_nonblocking) != napi_ok) {
    free(done->id);
    free(done->chat);
    free(done->reply);
    free(done);
  }
  completionHandler();
}
@end

static OtterNotificationDelegate *delegate;

static void InstallDelegate(void) {
  UNUserNotificationCenter *center = UNUserNotificationCenter.currentNotificationCenter;
  if (center.delegate == delegate) return;
  if (!delegate) {
    delegate = [OtterNotificationDelegate new];
    [center requestAuthorizationWithOptions:UNAuthorizationOptionAlert | UNAuthorizationOptionSound |
                                            UNAuthorizationOptionBadge
                          completionHandler:^(BOOL granted, NSError *error){
                          }];
  }
  // Electron sets itself as the delegate when it first shows a notification: wrap it again.
  delegate.next = center.delegate;
  center.delegate = delegate;
}

static BOOL HasEntitlement(void) {
  SecTaskRef task = SecTaskCreateFromSelf(NULL);
  if (!task) return NO;
  CFTypeRef value = SecTaskCopyValueForEntitlement(
      task, CFSTR("com.apple.developer.usernotifications.communication"), NULL);
  CFRelease(task);
  BOOL granted = value && CFGetTypeID(value) == CFBooleanGetTypeID() && CFBooleanGetValue(value);
  if (value) CFRelease(value);
  return granted;
}

static NSString *StringOf(napi_env env, napi_value value) {
  napi_valuetype type;
  napi_typeof(env, value, &type);
  if (type != napi_string) return nil;
  size_t length;
  napi_get_value_string_utf8(env, value, NULL, 0, &length);
  char *buffer = malloc(length + 1);
  napi_get_value_string_utf8(env, value, buffer, length + 1, &length);
  NSString *string = [[NSString alloc] initWithBytes:buffer
                                              length:length
                                            encoding:NSUTF8StringEncoding];
  free(buffer);
  return string;
}

static NSString *StringProp(napi_env env, napi_value object, const char *name) {
  napi_value value;
  if (napi_get_named_property(env, object, name, &value) != napi_ok) return nil;
  return StringOf(env, value);
}

static NSArray<NSString *> *StringsOf(napi_env env, napi_value list) {
  bool isArray = false;
  uint32_t length = 0;
  napi_is_array(env, list, &isArray);
  if (!isArray) return @[];
  napi_get_array_length(env, list, &length);
  NSMutableArray<NSString *> *strings = [NSMutableArray arrayWithCapacity:length];
  for (uint32_t i = 0; i < length; i++) {
    napi_value item;
    napi_get_element(env, list, i, &item);
    NSString *string = StringOf(env, item);
    if (string) [strings addObject:string];
  }
  return strings;
}

static NSArray<NSString *> *StringsProp(napi_env env, napi_value object, const char *name) {
  napi_value list;
  if (napi_get_named_property(env, object, name, &list) != napi_ok) return @[];
  return StringsOf(env, list);
}

static NSData *BufferProp(napi_env env, napi_value object, const char *name) {
  napi_value value;
  bool isBuffer = false;
  if (napi_get_named_property(env, object, name, &value) != napi_ok) return nil;
  napi_is_buffer(env, value, &isBuffer);
  if (!isBuffer) return nil;
  void *data;
  size_t length;
  napi_get_buffer_info(env, value, &data, &length);
  return [NSData dataWithBytes:data length:length];
}

static BOOL BoolProp(napi_env env, napi_value object, const char *name) {
  napi_value value;
  bool result = false;
  if (napi_get_named_property(env, object, name, &value) == napi_ok) {
    napi_get_value_bool(env, value, &result);
  }
  return result;
}

// The buttons and the reply field, as a category: Electron's way, which it merges the same way.
static NSString *CategoryFor(NSArray<NSString *> *buttons, NSString *reply) {
  if (buttons.count == 0 && !reply) return nil;
  NSMutableArray<UNNotificationAction *> *actions = [NSMutableArray array];
  NSMutableString *key = [NSMutableString string];
  if (reply) {
    [actions addObject:[UNTextInputNotificationAction actionWithIdentifier:kReplyAction
                                                                     title:@"Reply"
                                                                   options:0
                                                      textInputButtonTitle:@"Reply"
                                                      textInputPlaceholder:reply]];
    [key appendFormat:@"R:%@;", reply];
  }
  [buttons enumerateObjectsUsingBlock:^(NSString *title, NSUInteger i, BOOL *stop) {
    NSString *identifier = [NSString stringWithFormat:@"%@%lu", kActionPrefix, (unsigned long)i];
    [actions addObject:[UNNotificationAction actionWithIdentifier:identifier
                                                            title:title
                                                          options:0]];
    [key appendFormat:@"A:%@;", title];
  }];
  NSString *identifier = [NSString stringWithFormat:@"OTTER_%lu", (unsigned long)key.hash];
  UNNotificationCategory *category =
      [UNNotificationCategory categoryWithIdentifier:identifier
                                             actions:actions
                                   intentIdentifiers:@[]
                                             options:0];
  UNUserNotificationCenter *center = UNUserNotificationCenter.currentNotificationCenter;
  dispatch_semaphore_t registered = dispatch_semaphore_create(0);
  [center getNotificationCategoriesWithCompletionHandler:^(NSSet<UNNotificationCategory *> *all) {
    if (![all containsObject:category]) {
      [center setNotificationCategories:[all setByAddingObject:category]];
    }
    dispatch_semaphore_signal(registered);
  }];
  dispatch_semaphore_wait(registered, dispatch_time(DISPATCH_TIME_NOW, NSEC_PER_SEC));
  return identifier;
}

// Settles the promise post() returned, on the JS thread: data is the error message, or NULL.
static void SettleJs(napi_env env, napi_value js, void *context, void *data) {
  napi_deferred deferred = context;
  char *message = data;
  if (env) {
    if (message) {
      napi_value text, error;
      napi_create_string_utf8(env, message, NAPI_AUTO_LENGTH, &text);
      napi_create_error(env, NULL, text, &error);
      napi_reject_deferred(env, deferred, error);
    } else {
      napi_value undefined;
      napi_get_undefined(env, &undefined);
      napi_resolve_deferred(env, deferred, undefined);
    }
  }
  free(message);
}

static void Settle(napi_threadsafe_function settle, NSError *error) {
  char *message = error ? strdup(error.localizedDescription.UTF8String) : NULL;
  napi_call_threadsafe_function(settle, message, napi_tsfn_blocking);
  napi_release_threadsafe_function(settle, napi_tsfn_release);
}

// supported(): whether this build can post communication notifications.
static napi_value Supported(napi_env env, napi_callback_info info) {
  napi_value result;
  BOOL supported = NO;
  if (@available(macOS 12.0, *)) supported = HasEntitlement();
  napi_get_boolean(env, supported, &result);
  return result;
}

// post({ id, chat, conversation?, body?, sound?, silent?, actions?, reply?,
//        sender: { id, name, image? (Buffer) } })
static napi_value Post(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value options, sender, promise, name;
  napi_deferred deferred;
  napi_get_cb_info(env, info, &argc, &options, NULL, NULL);
  napi_create_promise(env, &deferred, &promise);
  napi_get_named_property(env, options, "sender", &sender);

  NSString *identifier = StringProp(env, options, "id") ?: NSUUID.UUID.UUIDString;
  NSString *chat = StringProp(env, options, "chat");
  NSString *conversation = StringProp(env, options, "conversation");
  NSString *senderId = StringProp(env, sender, "id");
  NSString *senderName = StringProp(env, sender, "name");
  NSData *image = BufferProp(env, sender, "image");
  NSString *sound = StringProp(env, options, "sound");

  UNMutableNotificationContent *content = [UNMutableNotificationContent new];
  content.title = senderName ?: @"";
  content.body = StringProp(env, options, "body") ?: @"";
  if (!BoolProp(env, options, "silent")) {
    content.sound =
        sound ? [UNNotificationSound soundNamed:sound] : UNNotificationSound.defaultSound;
  }
  if (chat) {
    content.threadIdentifier = chat;
    content.userInfo = @{kChatKey : chat};
  }
  NSString *category =
      CategoryFor(StringsProp(env, options, "actions"), StringProp(env, options, "reply"));
  if (category) content.categoryIdentifier = category;

  napi_threadsafe_function settle;
  napi_create_string_utf8(env, "otter-notifier", NAPI_AUTO_LENGTH, &name);
  napi_create_threadsafe_function(env, NULL, NULL, name, 0, 1, NULL, NULL, deferred, SettleJs,
                                  &settle);

  if (@available(macOS 12.0, *)) {
    InstallDelegate();
    INPersonHandle *handle = [[INPersonHandle alloc] initWithValue:senderId
                                                              type:INPersonHandleTypeUnknown];
    INImage *avatar = image ? [INImage imageWithImageData:image] : nil;
    INPerson *person = [[INPerson alloc] initWithPersonHandle:handle
                                               nameComponents:nil
                                                  displayName:senderName
                                                        image:avatar
                                            contactIdentifier:nil
                                             customIdentifier:senderId];
    INSpeakableString *group =
        conversation ? [[INSpeakableString alloc] initWithSpokenPhrase:conversation] : nil;
    INSendMessageIntent *intent =
        [[INSendMessageIntent alloc] initWithRecipients:nil
                                    outgoingMessageType:INOutgoingMessageTypeOutgoingMessageText
                                                content:content.body
                                     speakableGroupName:group
                                 conversationIdentifier:chat
                                            serviceName:nil
                                                 sender:person
                                            attachments:nil];
    if (avatar) [intent setImage:avatar forParameterNamed:@"sender"];
    INInteraction *interaction = [[INInteraction alloc] initWithIntent:intent response:nil];
    interaction.direction = INInteractionDirectionIncoming;
    [interaction donateInteractionWithCompletion:^(NSError *donateError) {
      NSError *error = nil;
      UNNotificationContent *updated = [content contentByUpdatingWithProvider:intent error:&error];
      if (!updated) {
        Settle(settle, error ?: donateError);
        return;
      }
      UNNotificationRequest *request = [UNNotificationRequest requestWithIdentifier:identifier
                                                                            content:updated
                                                                            trigger:nil];
      [UNUserNotificationCenter.currentNotificationCenter
          addNotificationRequest:request
           withCompletionHandler:^(NSError *addError) {
             Settle(settle, addError);
           }];
    }];
  } else {
    Settle(settle, [NSError errorWithDomain:@"otter-notifier"
                                       code:1
                                   userInfo:@{NSLocalizedDescriptionKey : @"Needs macOS 12."}]);
  }
  return promise;
}

// remove(ids: string[])
static napi_value Remove(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value ids;
  napi_get_cb_info(env, info, &argc, &ids, NULL, NULL);
  [UNUserNotificationCenter.currentNotificationCenter
      removeDeliveredNotificationsWithIdentifiers:StringsOf(env, ids)];
  return NULL;
}

static void SetString(napi_env env, napi_value object, const char *name, const char *string) {
  if (!string) return;
  napi_value value;
  napi_create_string_utf8(env, string, NAPI_AUTO_LENGTH, &value);
  napi_set_named_property(env, object, name, value);
}

static void ResponseJs(napi_env env, napi_value js, void *context, void *data) {
  Response *done = data;
  if (env) {
    napi_value argument, undefined;
    napi_create_object(env, &argument);
    SetString(env, argument, "id", done->id);
    SetString(env, argument, "chat", done->chat);
    SetString(env, argument, "reply", done->reply);
    if (done->action >= 0) {
      napi_value action;
      napi_create_int32(env, done->action, &action);
      napi_set_named_property(env, argument, "action", action);
    }
    napi_get_undefined(env, &undefined);
    napi_call_function(env, undefined, js, 1, &argument, NULL);
  }
  free(done->id);
  free(done->chat);
  free(done->reply);
  free(done);
}

// onResponse(({ id, chat, action?: number, reply?: string }) => void): a click, a button or a reply.
static napi_value OnResponse(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value callback, name;
  napi_get_cb_info(env, info, &argc, &callback, NULL, NULL);
  if (responseCallback) napi_release_threadsafe_function(responseCallback, napi_tsfn_abort);
  napi_create_string_utf8(env, "otter-notifier-response", NAPI_AUTO_LENGTH, &name);
  napi_create_threadsafe_function(env, callback, NULL, name, 0, 1, NULL, NULL, NULL, ResponseJs,
                                  &responseCallback);
  napi_unref_threadsafe_function(env, responseCallback);
  return NULL;
}

NAPI_MODULE_INIT(/* napi_env env, napi_value exports */) {
  napi_property_descriptor properties[] = {
      {"supported", NULL, Supported, NULL, NULL, NULL, napi_default, NULL},
      {"post", NULL, Post, NULL, NULL, NULL, napi_default, NULL},
      {"remove", NULL, Remove, NULL, NULL, NULL, napi_default, NULL},
      {"onResponse", NULL, OnResponse, NULL, NULL, NULL, napi_default, NULL},
  };
  napi_define_properties(env, exports, sizeof properties / sizeof *properties, properties);
  return exports;
}
