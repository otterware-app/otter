Pod::Spec.new do |s|
  s.name           = 'OtterBackground'
  s.version        = '1.0.0'
  s.summary        = "Otter Mail: the background app refresh task (BGTaskScheduler)."
  s.author         = 'Otterware'
  s.homepage       = 'https://github.com/otterware-app/otter-mail'
  s.license        = 'MIT'
  s.platforms      = { :ios => '18.0' }
  s.source         = { :path => '.' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks     = 'BackgroundTasks'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES', 'SWIFT_VERSION' => '5.0' }
  s.source_files = '**/*.swift'
end
