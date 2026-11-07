require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "OtterNet"
  s.version      = package["version"]
  s.summary      = "Otter Mail: otter-net"
  s.homepage     = "https://github.com/otterware-app/otter-mail"
  s.license      = "MIT"
  s.authors      = "Otterware"
  s.platforms    = { :ios => "18.0" }
  s.source       = { :git => "https://github.com/otterware-app/otter-mail.git", :tag => "#{s.version}" }
  s.source_files = ["ios/**/*.{h,m,mm,swift}", "cpp/**/*.{h,hpp,c,cpp}"]
  s.pod_target_xcconfig = {
    "CLANG_CXX_LANGUAGE_STANDARD" => "c++20",
    "SWIFT_VERSION" => "6.0",
  }

  load "nitrogen/generated/ios/OtterNet+autolinking.rb"
  add_nitrogen_files(s)

  s.dependency "React-jsi"
  s.dependency "React-callinvoker"

  install_modules_dependencies(s)
end
