// Which sitemap line robots.txt carries. The sitemap index exists in every build but lists archive pages, so it is advertised
// only when indexing is allowed AND the archive pages are switched on (features.archivePages, D-012).
import { absoluteUrl } from '../urls';

export function robotsSitemapUrl(opts: { allowIndexing: boolean; archivePages: boolean; site: string | URL | undefined }): string | null {
  if (opts.allowIndexing !== true || opts.archivePages !== true || !opts.site) return null;
  return absoluteUrl('/sitemap-index.xml', opts.site);
}
