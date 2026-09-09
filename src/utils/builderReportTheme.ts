// The builder working papers' theme now lives in the shared reportTheme, since
// the advance / contractor working papers print to the same house style. This
// file stays as a re-export so every existing builder import keeps working and
// the builder PDFs come out byte-identical.
//
// New report renderers should import from '@/utils/reportTheme' directly.
export * from '@/utils/reportTheme';
