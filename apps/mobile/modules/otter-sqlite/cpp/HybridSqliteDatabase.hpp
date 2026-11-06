#pragma once

#include "HybridSqliteDatabaseSpec.hpp"

#include <sqlite3.h>

#include <string>
#include <unordered_map>

namespace margelo::nitro::ottersqlite {

class HybridSqliteDatabase : public HybridSqliteDatabaseSpec {
public:
  HybridSqliteDatabase() : HybridObject(TAG) {}
  ~HybridSqliteDatabase() override;

  std::string getVersion() override;
  void open(const std::string& path) override;
  void close() override;
  void exec(const std::string& sql) override;
  std::vector<std::string> compileOptions() override;

  jsi::Value get(jsi::Runtime& runtime, const jsi::Value& thisValue, const jsi::Value* args, size_t count);
  jsi::Value all(jsi::Runtime& runtime, const jsi::Value& thisValue, const jsi::Value* args, size_t count);
  jsi::Value run(jsi::Runtime& runtime, const jsi::Value& thisValue, const jsi::Value* args, size_t count);

protected:
  void loadHybridMethods() override;

private:
  sqlite3* db_ = nullptr;
  std::unordered_map<std::string, sqlite3_stmt*> statements_;

  sqlite3_stmt* prepared(jsi::Runtime& runtime, const jsi::Value* args, size_t count);
  void fail(jsi::Runtime& runtime, sqlite3_stmt* statement);
};

} // namespace margelo::nitro::ottersqlite
