# Project-specific ProGuard / R8 rules.
# Appended to the defaults from proguard-android.txt and detox's
# proguard-rules-app.pro (see build.gradle).
#
# After changing this file, run a release build and exercise the app
# end-to-end. Reflection-heavy libraries (Realm, codegen turbomodules,
# bouncycastle, etc.) routinely surface as ClassNotFoundException or
# NoSuchMethodError at runtime under R8 — add a targeted -keep rule and
# rebuild; do not blanket -keep the world.

# ----- Hermes / React Native core -----
-keep class com.facebook.hermes.unicode.** { *; }
-keep class com.facebook.jni.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }

# Native modules autolinked under our own package
-keep class network.hashcash.wallet.** { *; }

# Reanimated uses reflection for JSI/worklets bindings
-keep class com.swmansion.reanimated.** { *; }
-keep class com.swmansion.worklets.** { *; }

# react-native-screens fragment factory (instantiated by reflection)
-keep class com.swmansion.rnscreens.** { *; }

# ----- Realm -----
# Realm uses bytecode weaving + reflection over generated proxy classes.
-keep class io.realm.annotations.RealmModule
-keep @io.realm.annotations.RealmModule class *
-keep class io.realm.internal.Keep
-keep @io.realm.internal.Keep class * { *; }
-keep class io.realm.** { *; }
-dontwarn io.realm.**
-dontwarn javax.**

# ----- Bouncy Castle / SpongyCastle (crypto deps) -----
-keep class org.bouncycastle.** { *; }
-keep class org.spongycastle.** { *; }
-dontwarn org.bouncycastle.**
-dontwarn org.spongycastle.**

# ----- Bugsnag (provides consumer rules; keep our enums for breadcrumbs) -----
-keep class com.bugsnag.android.** { *; }

# ----- OkHttp / okio (used transitively by native deps) -----
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn org.conscrypt.**

# ----- Kotlin reflection metadata -----
-keepattributes Signature, InnerClasses, EnclosingMethod
-keepattributes RuntimeVisibleAnnotations, RuntimeVisibleParameterAnnotations
-keepattributes AnnotationDefault

# Keep TurboModule spec interfaces by name (resolved via reflection from JS)
-keep,includedescriptorclasses class * implements com.facebook.react.turbomodule.core.interfaces.TurboModule { *; }
