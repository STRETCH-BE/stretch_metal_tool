# PDF fonts

Static instances of the Archivo variable font (OFL 1.1, Google Fonts —
`ofl/archivo/Archivo[wdth,wght].ttf`), generated with fontTools
`varLib.instancer` for `@react-pdf/renderer`, which cannot drive
variation axes:

| File | wdth | wght | Use in the quote PDF |
|---|---|---|---|
| Archivo-Regular.ttf | 100 | 400 | body |
| Archivo-Medium.ttf | 100 | 500 | table numbers |
| Archivo-Bold.ttf | 100 | 700 | labels, totals |
| ArchivoExpanded-Bold.ttf | 125 | 700 | eyebrows |
| ArchivoExpanded-Black.ttf | 125 | 900 | headings, wordmark |

The web UI uses the single variable woff2 in `/fonts` instead.
