#include "HybridWorkerHost.hpp"

#include <CoreFoundation/CoreFoundation.h>
#include <NitroModules/InstallNitro.hpp>
#include <mach/mach.h>
#include <os/log.h>
#include <sys/sysctl.h>
#include <sys/time.h>
#include <unistd.h>
#include <worklets/Compat/StableApi.h>
#include <worklets/WorkletRuntime/WorkletRuntime.h>

#include <chrono>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <thread>

namespace margelo::nitro::otterworker {

namespace fs = std::filesystem;

namespace {

/** Runs Nitro's callbacks and Promise settlements on the worker's own thread. */
class WorkletRuntimeDispatcher : public Dispatcher {
public:
  explicit WorkletRuntimeDispatcher(std::weak_ptr<worklets::WorkletRuntime> runtime) : runtime_(std::move(runtime)) {}

  void runAsync(std::function<void()>&& function) override {
    if (auto runtime = runtime_.lock()) {
      runtime->schedule([function = std::move(function)](jsi::Runtime&) { function(); });
    }
  }

  void runSync(std::function<void()>&& function) override {
    if (auto runtime = runtime_.lock()) {
      runtime->runSync([&function](jsi::Runtime&) { function(); });
    }
  }

private:
  std::weak_ptr<worklets::WorkletRuntime> runtime_;
};

std::string homeDirectory() {
  CFURLRef url = CFCopyHomeDirectoryURL();
  char path[PATH_MAX];
  bool ok = url && CFURLGetFileSystemRepresentation(url, true, reinterpret_cast<UInt8*>(path), PATH_MAX);
  if (url) CFRelease(url);
  return ok ? std::string(path) : std::string(getenv("HOME") ?: "/tmp");
}

std::optional<std::string> utf8(CFStringRef string) {
  CFIndex length = CFStringGetLength(string);
  CFIndex size = 0;
  CFStringGetBytes(string, CFRangeMake(0, length), kCFStringEncodingUTF8, 0, false, nullptr, 0, &size);
  std::string out(static_cast<size_t>(size), '\0');
  CFStringGetBytes(string, CFRangeMake(0, length), kCFStringEncodingUTF8, 0, false, reinterpret_cast<UInt8*>(out.data()), size,
                   nullptr);
  return out;
}

} // namespace

void HybridWorkerHost::loadHybridMethods() {
  HybridWorkerHostSpec::loadHybridMethods();
  registerHybrids(this, [](Prototype& prototype) { prototype.registerRawHybridMethod("installNitro", 1, &HybridWorkerHost::installNitro); });
}

jsi::Value HybridWorkerHost::installNitro(jsi::Runtime& runtime, const jsi::Value&, const jsi::Value* args, size_t count) {
  if (count < 1 || !args[0].isObject()) {
    throw jsi::JSError(runtime, "installNitro(workletRuntime) needs the runtime createWorkletRuntime returned.");
  }
  std::shared_ptr<worklets::WorkletRuntime> worker = worklets::getWorkletRuntimeFromHolder(runtime, args[0].asObject(runtime));
  auto dispatcher = std::make_shared<WorkletRuntimeDispatcher>(worker);
  worker->runSync([dispatcher](jsi::Runtime& workerRuntime) { margelo::nitro::install(workerRuntime, dispatcher); });
  return jsi::Value::undefined();
}

std::string HybridWorkerHost::getDataDirectory() {
  static const std::string directory = [] {
    auto path = fs::path(homeDirectory()) / "Library" / "Application Support" / "OtterMail";
    std::error_code error;
    fs::create_directories(path, error);
    return path.string();
  }();
  return directory;
}

std::shared_ptr<ArrayBuffer> HybridWorkerHost::randomBytes(double length) {
  auto buffer = ArrayBuffer::allocate(static_cast<size_t>(length));
  arc4random_buf(buffer->data(), buffer->size());
  return buffer;
}

std::optional<std::string> HybridWorkerHost::decodeText(const std::shared_ptr<ArrayBuffer>& bytes, const std::string& label) {
  CFStringRef name = CFStringCreateWithCString(nullptr, label.c_str(), kCFStringEncodingASCII);
  if (!name) return std::nullopt;
  CFStringEncoding encoding = CFStringConvertIANACharSetNameToEncoding(name);
  CFRelease(name);
  if (encoding == kCFStringEncodingInvalidId) return std::nullopt;
  CFStringRef text = CFStringCreateWithBytes(nullptr, bytes->data(), static_cast<CFIndex>(bytes->size()), encoding, false);
  // A byte the charset has no character for: read it as Latin-1 rather than lose the message.
  if (!text) text = CFStringCreateWithBytes(nullptr, bytes->data(), static_cast<CFIndex>(bytes->size()), kCFStringEncodingISOLatin1, false);
  if (!text) return std::nullopt;
  auto out = utf8(text);
  CFRelease(text);
  return out;
}

std::optional<std::shared_ptr<ArrayBuffer>> HybridWorkerHost::readFile(const std::string& path) {
  std::ifstream file(fs::path(getDataDirectory()) / path, std::ios::binary | std::ios::ate);
  if (!file) return std::nullopt;
  auto size = static_cast<size_t>(file.tellg());
  file.seekg(0);
  auto buffer = ArrayBuffer::allocate(size);
  file.read(reinterpret_cast<char*>(buffer->data()), static_cast<std::streamsize>(size));
  return buffer;
}

void HybridWorkerHost::writeFile(const std::string& path, const std::shared_ptr<ArrayBuffer>& data) {
  auto target = fs::path(getDataDirectory()) / path;
  fs::create_directories(target.parent_path());
  auto temporary = target;
  temporary += ".tmp";
  {
    std::ofstream file(temporary, std::ios::binary | std::ios::trunc);
    if (!file) throw std::runtime_error("Couldn't write " + path);
    file.write(reinterpret_cast<const char*>(data->data()), static_cast<std::streamsize>(data->size()));
  }
  fs::rename(temporary, target);
}

void HybridWorkerHost::removeFile(const std::string& path) {
  std::error_code error;
  fs::remove(fs::path(getDataDirectory()) / path, error);
}

std::vector<FileEntry> HybridWorkerHost::listFiles(const std::string& directory) {
  std::vector<FileEntry> entries;
  std::error_code error;
  for (const auto& entry : fs::directory_iterator(fs::path(getDataDirectory()) / directory, error)) {
    if (!entry.is_regular_file()) continue;
    auto modified = std::chrono::duration_cast<std::chrono::milliseconds>(
                        std::chrono::clock_cast<std::chrono::system_clock>(entry.last_write_time()).time_since_epoch())
                        .count();
    entries.emplace_back(entry.path().filename().string(), static_cast<double>(entry.file_size()), static_cast<double>(modified));
  }
  return entries;
}

void HybridWorkerHost::log(const std::string& level, const std::string& message) {
  static os_log_t logger = os_log_create("dev.otterware.mail", "core");
  os_log_type_t type = level == "error" ? OS_LOG_TYPE_ERROR : level == "debug" ? OS_LOG_TYPE_DEBUG : OS_LOG_TYPE_DEFAULT;
  os_log_with_type(logger, type, "%{public}s %{public}s", level.c_str(), message.c_str());
}

double HybridWorkerHost::now() {
  return std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now().time_since_epoch()).count();
}

double HybridWorkerHost::residentMemory() {
  task_vm_info_data_t info;
  mach_msg_type_number_t count = TASK_VM_INFO_COUNT;
  if (task_info(mach_task_self(), TASK_VM_INFO, reinterpret_cast<task_info_t>(&info), &count) != KERN_SUCCESS) return 0;
  return static_cast<double>(info.phys_footprint);
}

double HybridWorkerHost::processUptime() {
  kinfo_proc info{};
  size_t size = sizeof(info);
  int mib[4] = {CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid()};
  if (sysctl(mib, 4, &info, &size, nullptr, 0) != 0) return 0;
  timeval now{};
  gettimeofday(&now, nullptr);
  const timeval& start = info.kp_proc.p_starttime;
  return (now.tv_sec - start.tv_sec) * 1000.0 + (now.tv_usec - start.tv_usec) / 1000.0;
}

std::shared_ptr<Promise<double>> HybridWorkerHost::echo(double value, double delayMs) {
  return Promise<double>::async([value, delayMs] {
    if (delayMs > 0) std::this_thread::sleep_for(std::chrono::microseconds(static_cast<int64_t>(delayMs * 1000)));
    return value;
  });
}

} // namespace margelo::nitro::otterworker
