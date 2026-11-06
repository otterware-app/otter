#import <UIKit/UIKit.h>
#import <react/renderer/textlayoutmanager/RCTFontUtils.h>

/**
 * Inter, the Mac and web apps' face (apps/web/src/styles.css), as the text's
 * default: what doesn't name a fontFamily is set in it, at its weight. Italic
 * stays the system's (Inter Variable has no italic to switch to).
 */
@interface OtterInterFont : NSObject
@end

@implementation OtterInterFont

+ (void)load
{
  RCTSetDefaultFontResolver(^UIFont *(const RCTFontProperties &properties) {
    if (properties.style == RCTFontStyleItalic || properties.style == RCTFontStyleOblique) {
      return nil;
    }
    CGFloat multiplier = isnan(properties.sizeMultiplier) ? 1 : properties.sizeMultiplier;
    UIFontDescriptor *descriptor = [UIFontDescriptor fontDescriptorWithFontAttributes:@{
      UIFontDescriptorFamilyAttribute : @"Inter Variable",
      UIFontDescriptorTraitsAttribute :
          @{UIFontWeightTrait : @(isnan(properties.weight) ? UIFontWeightRegular : properties.weight)},
    }];
    UIFont *font = [UIFont fontWithDescriptor:descriptor size:properties.size * multiplier];
    return [font.familyName isEqualToString:@"Inter Variable"] ? font : nil;
  });
}

@end
