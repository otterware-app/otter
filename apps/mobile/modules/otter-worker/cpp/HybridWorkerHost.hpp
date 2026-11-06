#pragma once

#include "HybridWorkerHostSpec.hpp"

namespace margelo::nitro::otterworker {

class HybridWorkerHost : public HybridWorkerHostSpec {
public:
  HybridWorkerHost() : HybridObject(TAG) {}

  std::string getDataDirectory() override;
  std::shared_ptr<ArrayBuffer> randomBytes(double length) override;
  std::optional<std::string> decodeText(const std::shared_ptr<ArrayBuffer>& bytes, const std::string& label) override;
  std::optional<std::shared_ptr<ArrayBuffer>> readFile(const std::string& path) override;
  void writeFile(const std::string& path, const std::shared_ptr<ArrayBuffer>& data) override;
  void removeFile(const std::string& path) override;
  std::vector<FileEntry> listFiles(const std::string& directory) override;
  void log(const std::string& level, const std::string& message) override;
  double now() override;
  double residentMemory() override;
  double processUptime() override;
  std::shared_ptr<Promise<double>> echo(double value, double delayMs) override;

  /**
   * `installNitro(workletRuntime)`, from the React Native runtime: puts
   * `NitroModulesProxy` and a Dispatcher on the worker so its Promises and
   * callbacks resolve there. Bundle Mode blocks TurboModules on worker
   * runtimes, which is how Nitro installs itself everywhere else.
   */
  jsi::Value installNitro(jsi::Runtime& runtime, const jsi::Value& thisValue, const jsi::Value* args, size_t count);

protected:
  void loadHybridMethods() override;
};

} // namespace margelo::nitro::otterworker
