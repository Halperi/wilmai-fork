# Room constructs WorkManager's generated database via reflection. Keep its
# implementation and no-argument constructor under AGP 9 release optimization.
-keep class androidx.work.impl.WorkDatabase_Impl { *; }
