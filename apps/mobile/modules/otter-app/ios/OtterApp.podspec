Pod::Spec.new do |s|
  s.name           = 'OtterApp'
  s.version        = '1.0.0'
  s.summary        = "Otter Mail: the app's typeface, its version, and the Swift app's leftovers."
  s.author         = 'Otterware'
  s.homepage       = 'https://github.com/otterware-app/otter-mail'
  s.license        = 'MIT'
  s.platforms      = { :ios => '18.0' }
  s.source         = { :path => '.' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.dependency 'React-FabricComponents'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_VERSION' => '5.0',
    'CLANG_CXX_LANGUAGE_STANDARD' => 'c++20',
  }
  s.source_files = '**/*.{swift,mm}'
  install_modules_dependencies(s)
end
