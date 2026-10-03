import type { MetadataRoute } from 'next';
import { site } from '@/lib/site';

export default function sitemap(): MetadataRoute.Sitemap {
  const routes = [
    { path: '/', priority: 1 },
    { path: '/variants', priority: 0.9 },
    { path: '/bench', priority: 0.8 },
    { path: '/flight', priority: 0.7 },
    { path: '/export', priority: 0.6 },
    { path: '/agent', priority: 0.6 },
    { path: '/settings', priority: 0.4 },
    { path: '/verify', priority: 0.4 },
  ];

  return routes.map((route) => ({
    url: `${site.liveUrl}${route.path}`,
    lastModified: new Date(),
    changeFrequency: 'weekly' as const,
    priority: route.priority,
  }));
}