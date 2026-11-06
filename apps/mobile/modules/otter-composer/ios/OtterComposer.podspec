Pod::Spec.new do |s|
  s.name           = 'OtterComposer'
  s.version        = '1.0.0'
  s.summary        = "Otter Mail: the composer's editor (the web's TipTap schema) in WebKit."
  s.author         = 'Otterware'
  s.homepage       = 'https://github.com/otterware-app/otter-mail'
  s.license        = 'MIT'
  s.platforms      = { :ios => '18.0' }
  s.source         = { :path => '.' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES', 'SWIFT_VERSION' => '6.0' }
  s.source_files = '**/*.swift'
  s.resource_bundles = { 'OtterComposer' => ['Resources/composer.html'] }
end
