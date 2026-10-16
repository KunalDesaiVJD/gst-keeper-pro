// Draws Reports Hub views to static HTML with the real React (no effects run),
// for the checks of what a view itself shows: its tiles, notes, rows and the
// "filtered" export it would write. Each view's useTableKit is wrapped, so a
// check can set the kit's state before the HTML is drawn (a search, a filter,
// a grouping) and read afterwards the kit and the options the view drew with.
// Supabase, the signed-in user, toasts and the file writers are stand-ins:
// nothing is read or written anywhere.
//
//   const V = await loadViews(root, ['AnnualTrendView']);
//   const { html, text, kit, options } = V.draw('AnnualTrendView', table, V.report('sus-one'), (kit) => kit.setSearch('Jun 2026'));
//   const exported = V.exported(kit, options);   // the "Excel (filtered)" table
//   const merged = V.mergeTables([apr, may], ['04/2026', '05/2026']);   // the app's own merge
//
// Used by scripts/verify-report-views.mjs.
import { createRequire } from 'node:module';
import path from 'node:path';

const STUBS = (kitIndex) => ({
  supabase: `const q = new Proxy(function () {}, { get: (_t, k) => (k === 'then' ? undefined : q), apply: () => q }); export const supabase = q;`,
  auth: `export const useAuth = () => ({ user: { id: 'u', firstName: 'Check' }, canEditNoticeStatus: () => true }); export const AuthProvider = ({ children }) => children;`,
  sonner: `export const toast = Object.assign(() => {}, { success() {}, error() {}, info() {}, warning() {} }); export const Toaster = () => null;`,
  writers: `export const renderReportToExcel = async () => {}; export const renderReportToPdf = async () => {};`,
  // The kit as a view imports it, its hook wrapped: a preset runs once, in the
  // first render, and the kit of the last render is left on globalThis.
  kit: `
    import * as React from 'react';
    import { useTableKit as real } from ${JSON.stringify(kitIndex)};
    export * from ${JSON.stringify(kitIndex)};
    export function useTableKit(table, options) {
      const kit = real(table, options);
      const done = React.useRef(false);
      const g = globalThis;
      if (!done.current && g.__kitPreset) { done.current = true; g.__kitPreset(kit); }
      g.__kit = kit;
      g.__kitOptions = options;
      return kit;
    }`,
});

/** Builds the named views (files in src/components/reports/views) into one bundle and returns a drawer. */
export async function loadViews(root, names) {
  const { build } = createRequire(path.join(root, 'package.json'))('esbuild');
  const viewsDir = path.join(root, 'src', 'components', 'reports', 'views');
  const kitIndex = path.join(viewsDir, 'tableKit', 'index.ts');
  const stubs = STUBS(kitIndex);
  const plugin = {
    name: 'views',
    setup(b) {
      const stub = (key) => () => ({ path: key, namespace: 'stub' });
      b.onResolve({ filter: /^@\/integrations\/supabase\/client$/ }, stub('supabase'));
      b.onResolve({ filter: /^@\/contexts\/AuthContext$/ }, stub('auth'));
      b.onResolve({ filter: /^sonner$/ }, stub('sonner'));
      b.onResolve({ filter: /^@\/utils\/(allClientsReports|closingBalanceReportsPdf)$/ }, stub('writers'));
      b.onResolve({ filter: /^\.\/tableKit$/ }, (a) => (path.dirname(a.importer) === viewsDir ? { path: 'kit', namespace: 'stub' } : undefined));
      b.onResolve({ filter: /^@\// }, (a) => b.resolve(`./${a.path.slice(2)}`, { resolveDir: path.join(root, 'src'), kind: a.kind }));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: stubs[a.path], loader: 'js', resolveDir: root }));
    },
  };
  const out = await build({
    stdin: {
      contents: `
        import React from 'react';
        import { renderToStaticMarkup } from 'react-dom/server';
        import { MemoryRouter } from 'react-router-dom';
        ${names.map((n) => `import { ${n} } from ${JSON.stringify(path.join(viewsDir, n))};`).join('\n')}
        export { viewToReportTable } from ${JSON.stringify(kitIndex)};
        export { mergeTables, buildForPeriods } from ${JSON.stringify(path.join(root, 'src', 'lib', 'reportPeriodMerge.ts'))};
        const VIEWS = { ${names.join(', ')} };
        export function drawView(name, table, report, preset) {
          const g = globalThis;
          g.__kitPreset = preset ?? null;
          g.__kit = null;
          g.__kitOptions = null;
          const html = renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(VIEWS[name], { table, report })));
          return { html, kit: g.__kit, options: g.__kitOptions };
        }
      `,
      resolveDir: root, loader: 'tsx',
    },
    bundle: true, format: 'esm', platform: 'node', write: false, jsx: 'automatic', logLevel: 'error',
    plugins: [plugin],
    define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{}' },
    loader: { '.css': 'empty', '.png': 'dataurl', '.svg': 'dataurl' },
    // React's server build requires Node's own modules; a data: URL cannot resolve them, the root can.
    banner: { js: `import { createRequire as __cr } from 'node:module'; const require = __cr(${JSON.stringify(path.join(root, 'package.json'))});` },
  });
  const B = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));

  /** The HTML as lines of text: a cell ends " | ", a row a line. */
  const textOf = (html) => html
    .replace(/<\/(td|th)>/g, ' | ').replace(/<\/(tr|p|li|h\d|div)>/g, '\n').replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');
  return {
    /** A report definition as the views read it. */
    report: (key, title = key, extra = {}) => ({ key, title, description: '', icon: () => null, category: 'extra', status: 'ready', needs: 'month', viewKind: '', build: async () => null, ...extra }),
    /** The view drawn; `preset(kit)` sets the kit's state first. */
    draw(name, table, report, preset) {
      const r = B.drawView(name, table, report, preset);
      return { ...r, text: textOf(r.html) };
    },
    /** The app's own multi-month merge (reportPeriodMerge.ts): several periods' tables as one. */
    mergeTables: B.mergeTables,
    /** Builds a report for each period and merges them, a period that throws as its "Not built" block. */
    buildForPeriods: B.buildForPeriods,
    /** The "filtered" export the kit would hand the writer, as exportView builds it. */
    exported(kit, options, format = 'xlsx') {
      const t = B.viewToReportTable(kit.table, kit.model, kit.state, kit.hidden);
      return options?.transformExport ? options.transformExport(t, format) : t;
    },
  };
}
