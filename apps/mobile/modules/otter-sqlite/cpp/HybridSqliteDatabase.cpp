#include "HybridSqliteDatabase.hpp"

#include <cmath>
#include <cstring>

namespace margelo::nitro::ottersqlite {

namespace {

constexpr double kMaxSafeInteger = 9007199254740991.0;

class OwnedBuffer : public jsi::MutableBuffer {
public:
  OwnedBuffer(const void* data, size_t size) : bytes_(static_cast<const uint8_t*>(data), static_cast<const uint8_t*>(data) + size) {}
  size_t size() const override { return bytes_.size(); }
  uint8_t* data() override { return bytes_.data(); }

private:
  std::vector<uint8_t> bytes_;
};

void bind(jsi::Runtime& runtime, sqlite3_stmt* statement, int index, const jsi::Value& value) {
  if (value.isNull() || value.isUndefined()) {
    sqlite3_bind_null(statement, index);
  } else if (value.isNumber()) {
    double number = value.getNumber();
    if (std::trunc(number) == number && std::fabs(number) <= kMaxSafeInteger) {
      sqlite3_bind_int64(statement, index, static_cast<sqlite3_int64>(number));
    } else {
      sqlite3_bind_double(statement, index, number);
    }
  } else if (value.isBool()) {
    sqlite3_bind_int(statement, index, value.getBool() ? 1 : 0);
  } else if (value.isString()) {
    std::string text = value.getString(runtime).utf8(runtime);
    sqlite3_bind_text(statement, index, text.data(), static_cast<int>(text.size()), SQLITE_TRANSIENT);
  } else if (value.isBigInt()) {
    sqlite3_bind_int64(statement, index, value.getBigInt(runtime).asInt64(runtime));
  } else if (value.isObject()) {
    jsi::Object object = value.getObject(runtime);
    if (object.isArrayBuffer(runtime)) {
      jsi::ArrayBuffer buffer = object.getArrayBuffer(runtime);
      sqlite3_bind_blob(statement, index, buffer.data(runtime), static_cast<int>(buffer.size(runtime)), SQLITE_TRANSIENT);
      return;
    }
    jsi::Value inner = object.getProperty(runtime, "buffer");
    if (inner.isObject() && inner.getObject(runtime).isArrayBuffer(runtime)) {
      jsi::ArrayBuffer buffer = inner.getObject(runtime).getArrayBuffer(runtime);
      auto offset = static_cast<size_t>(object.getProperty(runtime, "byteOffset").asNumber());
      auto length = static_cast<size_t>(object.getProperty(runtime, "byteLength").asNumber());
      sqlite3_bind_blob(statement, index, buffer.data(runtime) + offset, static_cast<int>(length), SQLITE_TRANSIENT);
      return;
    }
    throw jsi::JSError(runtime, "SQLite can't bind this object.");
  } else {
    throw jsi::JSError(runtime, "SQLite can't bind this value.");
  }
}

jsi::Value column(jsi::Runtime& runtime, sqlite3_stmt* statement, int index) {
  switch (sqlite3_column_type(statement, index)) {
    case SQLITE_INTEGER: {
      sqlite3_int64 integer = sqlite3_column_int64(statement, index);
      if (std::fabs(static_cast<double>(integer)) <= kMaxSafeInteger) return jsi::Value(static_cast<double>(integer));
      return jsi::BigInt::fromInt64(runtime, integer);
    }
    case SQLITE_FLOAT:
      return jsi::Value(sqlite3_column_double(statement, index));
    case SQLITE_TEXT: {
      auto text = reinterpret_cast<const char*>(sqlite3_column_text(statement, index));
      return jsi::String::createFromUtf8(runtime, reinterpret_cast<const uint8_t*>(text),
                                         static_cast<size_t>(sqlite3_column_bytes(statement, index)));
    }
    case SQLITE_BLOB: {
      auto bytes = std::make_shared<OwnedBuffer>(sqlite3_column_blob(statement, index),
                                                 static_cast<size_t>(sqlite3_column_bytes(statement, index)));
      jsi::ArrayBuffer buffer(runtime, bytes);
      return runtime.global().getPropertyAsFunction(runtime, "Uint8Array").callAsConstructor(runtime, std::move(buffer));
    }
    default:
      return jsi::Value::null();
  }
}

std::vector<jsi::PropNameID> columnNames(jsi::Runtime& runtime, sqlite3_stmt* statement) {
  int count = sqlite3_column_count(statement);
  std::vector<jsi::PropNameID> names;
  names.reserve(static_cast<size_t>(count));
  for (int i = 0; i < count; i++) names.push_back(jsi::PropNameID::forUtf8(runtime, sqlite3_column_name(statement, i)));
  return names;
}

jsi::Object row(jsi::Runtime& runtime, sqlite3_stmt* statement, const std::vector<jsi::PropNameID>& names) {
  jsi::Object object(runtime);
  for (size_t i = 0; i < names.size(); i++) object.setProperty(runtime, names[i], column(runtime, statement, static_cast<int>(i)));
  return object;
}

/** Resets the statement however the call ends, so a thrown step doesn't leave it busy. */
struct Reset {
  sqlite3_stmt* statement;
  ~Reset() {
    sqlite3_reset(statement);
    sqlite3_clear_bindings(statement);
  }
};

} // namespace

HybridSqliteDatabase::~HybridSqliteDatabase() {
  close();
}

void HybridSqliteDatabase::loadHybridMethods() {
  HybridSqliteDatabaseSpec::loadHybridMethods();
  registerHybrids(this, [](Prototype& prototype) {
    prototype.registerRawHybridMethod("get", 2, &HybridSqliteDatabase::get);
    prototype.registerRawHybridMethod("all", 2, &HybridSqliteDatabase::all);
    prototype.registerRawHybridMethod("run", 2, &HybridSqliteDatabase::run);
  });
}

std::string HybridSqliteDatabase::getVersion() {
  return sqlite3_libversion();
}

std::vector<std::string> HybridSqliteDatabase::compileOptions() {
  std::vector<std::string> options;
  for (int i = 0; const char* option = sqlite3_compileoption_get(i); i++) options.emplace_back(option);
  return options;
}

void HybridSqliteDatabase::open(const std::string& path) {
  close();
  int flags = SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_NOMUTEX;
  if (sqlite3_open_v2(path.c_str(), &db_, flags, nullptr) != SQLITE_OK) {
    std::string message = db_ ? sqlite3_errmsg(db_) : "out of memory";
    close();
    throw std::runtime_error("Couldn't open the mail cache: " + message);
  }
  sqlite3_busy_timeout(db_, 5000);
  exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;");
}

void HybridSqliteDatabase::close() {
  for (auto& [_, statement] : statements_) sqlite3_finalize(statement);
  statements_.clear();
  if (db_) sqlite3_close_v2(db_);
  db_ = nullptr;
}

void HybridSqliteDatabase::exec(const std::string& sql) {
  if (!db_) throw std::runtime_error("The database is closed.");
  char* error = nullptr;
  if (sqlite3_exec(db_, sql.c_str(), nullptr, nullptr, &error) != SQLITE_OK) {
    std::string message = error ? error : sqlite3_errmsg(db_);
    sqlite3_free(error);
    throw std::runtime_error(message);
  }
}

sqlite3_stmt* HybridSqliteDatabase::prepared(jsi::Runtime& runtime, const jsi::Value* args, size_t count) {
  if (!db_) throw jsi::JSError(runtime, "The database is closed.");
  if (count < 1 || !args[0].isString()) throw jsi::JSError(runtime, "SQL must be a string.");
  std::string sql = args[0].getString(runtime).utf8(runtime);
  sqlite3_stmt* statement;
  if (auto found = statements_.find(sql); found != statements_.end()) {
    statement = found->second;
  } else {
    if (sqlite3_prepare_v3(db_, sql.c_str(), static_cast<int>(sql.size()), SQLITE_PREPARE_PERSISTENT, &statement, nullptr) != SQLITE_OK) {
      throw jsi::JSError(runtime, std::string(sqlite3_errmsg(db_)) + " in: " + sql);
    }
    statements_.emplace(std::move(sql), statement);
  }
  if (count > 1 && args[1].isObject()) {
    jsi::Array params = args[1].getObject(runtime).getArray(runtime);
    size_t length = params.size(runtime);
    for (size_t i = 0; i < length; i++) bind(runtime, statement, static_cast<int>(i + 1), params.getValueAtIndex(runtime, i));
  }
  return statement;
}

void HybridSqliteDatabase::fail(jsi::Runtime& runtime, sqlite3_stmt*) {
  throw jsi::JSError(runtime, sqlite3_errmsg(db_));
}

jsi::Value HybridSqliteDatabase::get(jsi::Runtime& runtime, const jsi::Value&, const jsi::Value* args, size_t count) {
  sqlite3_stmt* statement = prepared(runtime, args, count);
  Reset reset{statement};
  int status = sqlite3_step(statement);
  if (status == SQLITE_DONE) return jsi::Value::undefined();
  if (status != SQLITE_ROW) fail(runtime, statement);
  return row(runtime, statement, columnNames(runtime, statement));
}

jsi::Value HybridSqliteDatabase::all(jsi::Runtime& runtime, const jsi::Value&, const jsi::Value* args, size_t count) {
  sqlite3_stmt* statement = prepared(runtime, args, count);
  Reset reset{statement};
  std::vector<jsi::PropNameID> names = columnNames(runtime, statement);
  std::vector<jsi::Value> rows;
  int status;
  while ((status = sqlite3_step(statement)) == SQLITE_ROW) rows.emplace_back(row(runtime, statement, names));
  if (status != SQLITE_DONE) fail(runtime, statement);
  jsi::Array array(runtime, rows.size());
  for (size_t i = 0; i < rows.size(); i++) array.setValueAtIndex(runtime, i, std::move(rows[i]));
  return array;
}

jsi::Value HybridSqliteDatabase::run(jsi::Runtime& runtime, const jsi::Value&, const jsi::Value* args, size_t count) {
  sqlite3_stmt* statement = prepared(runtime, args, count);
  Reset reset{statement};
  int status;
  while ((status = sqlite3_step(statement)) == SQLITE_ROW) {
  }
  if (status != SQLITE_DONE) fail(runtime, statement);
  jsi::Object result(runtime);
  result.setProperty(runtime, "changes", static_cast<double>(sqlite3_changes64(db_)));
  result.setProperty(runtime, "lastInsertRowid", static_cast<double>(sqlite3_last_insert_rowid(db_)));
  return result;
}

} // namespace margelo::nitro::ottersqlite
