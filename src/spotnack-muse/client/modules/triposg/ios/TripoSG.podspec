Pod::Spec.new do |s|
  s.name           = 'TripoSG'
  s.version        = '1.0.0'
  s.summary        = 'On-device TripoSG image-to-3D (iOS stub; Android-only inference).'
  s.description    = 'Expo module wrapping the portable TripoSG C++ core. iOS reports unsupported.'
  s.author         = ''
  s.homepage       = ''
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = "**/*.{h,m,mm,swift,cpp}"
end
