Pod::Spec.new do |s|
  s.name           = 'OtterHtmlView'
  s.version        = '1.0.0'
  s.summary        = "Otter Mail: a message's HTML in WebKit, as tall as its content."
  s.author         = 'Otterware'
  s.homepage       = 'https://github.com/otterware-app/otter-mail'
  s.license        = 'MIT'
  s.platforms      = { :ios => '18.0' }
  s.source         = { :path => '.' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES', 'SWIFT_VERSION' => '6.0' }
  s.source_files = '**/*.swift'
end
