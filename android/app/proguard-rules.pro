# Project-specific ProGuard/R8 rules.
#
# Release hardening happens at the v1 checklist (playbook §10). One rule is
# known in advance and kept here from day one: JS bridge objects are called
# reflectively from JavaScript, so @JavascriptInterface members must survive
# minification (relevant from M1 when the bridge lands).
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
