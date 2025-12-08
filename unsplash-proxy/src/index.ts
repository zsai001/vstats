/**
 * vStats Unsplash Proxy - Cloudflare Worker
 *
 * This worker proxies Unsplash API requests for vStats instances.
 * Since source.unsplash.com is deprecated, we use the official Unsplash API.
 *
 * Endpoints:
 * - GET /random?query=nature,landscape - Get a random photo URL
 * - GET /photo/:id - Get a specific photo by ID
 * - GET /health - Health check
 */

export interface Env {
  UNSPLASH_ACCESS_KEY: string;
}

// CORS headers for cross-origin requests
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

// Cache configuration
const CACHE_TTL = 300; // 5 minutes cache

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Only allow GET requests
    if (request.method !== 'GET') {
      return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    try {
      // Random photo endpoint
      if (path === '/random') {
        return handleRandomPhoto(url, env, ctx);
      }

      // Get specific photo by ID
      if (path.startsWith('/photo/')) {
        const photoId = path.replace('/photo/', '');
        return handleGetPhoto(photoId, env, ctx);
      }

      // Search photos endpoint
      if (path === '/search') {
        return handleSearchPhotos(url, env, ctx);
      }

      // Health check
      if (path === '/health' || path === '/') {
        return jsonResponse({
          status: 'ok',
          service: 'vStats Unsplash Proxy',
          endpoints: [
            'GET /random?query=nature&orientation=landscape&w=1920&h=1080',
            'GET /photo/:id',
            'GET /search?query=nature&page=1&per_page=10',
            'GET /health',
          ],
        });
      }

      return jsonResponse({ error: 'Not Found' }, 404);
    } catch (error) {
      console.error('Error:', error);
      return jsonResponse({ error: 'Internal Server Error' }, 500);
    }
  },
};

/**
 * Handle random photo request
 * GET /random?query=nature,landscape&orientation=landscape&w=1920&h=1080
 */
async function handleRandomPhoto(url: URL, env: Env, ctx: ExecutionContext): Promise<Response> {
  const query = url.searchParams.get('query') || 'nature,landscape';
  const orientation = url.searchParams.get('orientation') || 'landscape';
  const width = url.searchParams.get('w') || '1920';
  const height = url.searchParams.get('h') || '1080';

  // Build cache key
  const cacheKey = `random:${query}:${orientation}`;

  // Check cache (using Cloudflare Cache API)
  const cache = caches.default;
  const cacheUrl = new URL(url.origin + '/cache/' + btoa(cacheKey));
  const cachedResponse = await cache.match(cacheUrl);

  if (cachedResponse) {
    // Return cached response with cache hit header
    const response = new Response(cachedResponse.body, cachedResponse);
    response.headers.set('X-Cache', 'HIT');
    return response;
  }

  // Fetch from Unsplash API
  const unsplashUrl = new URL('https://api.unsplash.com/photos/random');
  unsplashUrl.searchParams.set('query', query);
  unsplashUrl.searchParams.set('orientation', orientation);
  unsplashUrl.searchParams.set('content_filter', 'high'); // Safe content only

  const unsplashResponse = await fetch(unsplashUrl.toString(), {
    headers: {
      Authorization: `Client-ID ${env.UNSPLASH_ACCESS_KEY}`,
      'Accept-Version': 'v1',
      'User-Agent': 'vStats-Unsplash-Proxy',
    },
  });

  if (!unsplashResponse.ok) {
    const errorText = await unsplashResponse.text();
    console.error('Unsplash API error:', unsplashResponse.status, errorText);

    // Return fallback image URL (Picsum as fallback)
    return jsonResponse({
      url: `https://picsum.photos/${width}/${height}`,
      fallback: true,
      error: `Unsplash API error: ${unsplashResponse.status}`,
    });
  }

  const photo = (await unsplashResponse.json()) as UnsplashPhoto;

  // Build optimized image URL with requested dimensions
  const imageUrl = buildImageUrl(photo.urls.raw, parseInt(width), parseInt(height));

  const responseData = {
    url: imageUrl,
    id: photo.id,
    description: photo.description || photo.alt_description,
    author: {
      name: photo.user.name,
      username: photo.user.username,
      link: photo.user.links.html,
    },
    links: {
      unsplash: photo.links.html,
      download: photo.links.download_location,
    },
    color: photo.color,
    blur_hash: photo.blur_hash,
  };

  const response = jsonResponse(responseData);

  // Cache the response
  response.headers.set('Cache-Control', `public, max-age=${CACHE_TTL}`);
  response.headers.set('X-Cache', 'MISS');

  // Store in cache (non-blocking)
  const cacheResponse = new Response(JSON.stringify(responseData), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': `public, max-age=${CACHE_TTL}`,
      ...corsHeaders,
    },
  });
  ctx.waitUntil(cache.put(cacheUrl, cacheResponse));

  return response;
}

/**
 * Handle get specific photo by ID
 * GET /photo/:id
 */
async function handleGetPhoto(photoId: string, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (!photoId) {
    return jsonResponse({ error: 'Photo ID is required' }, 400);
  }

  const width = '1920';
  const height = '1080';

  // Fetch from Unsplash API
  const unsplashUrl = `https://api.unsplash.com/photos/${photoId}`;

  const unsplashResponse = await fetch(unsplashUrl, {
    headers: {
      Authorization: `Client-ID ${env.UNSPLASH_ACCESS_KEY}`,
      'Accept-Version': 'v1',
      'User-Agent': 'vStats-Unsplash-Proxy',
    },
  });

  if (!unsplashResponse.ok) {
    if (unsplashResponse.status === 404) {
      return jsonResponse({ error: 'Photo not found' }, 404);
    }
    const errorText = await unsplashResponse.text();
    console.error('Unsplash API error:', unsplashResponse.status, errorText);
    return jsonResponse({ error: 'Failed to fetch photo' }, 502);
  }

  const photo = (await unsplashResponse.json()) as UnsplashPhoto;
  const imageUrl = buildImageUrl(photo.urls.raw, parseInt(width), parseInt(height));

  return jsonResponse({
    url: imageUrl,
    id: photo.id,
    description: photo.description || photo.alt_description,
    author: {
      name: photo.user.name,
      username: photo.user.username,
      link: photo.user.links.html,
    },
    links: {
      unsplash: photo.links.html,
      download: photo.links.download_location,
    },
    color: photo.color,
    blur_hash: photo.blur_hash,
  });
}

/**
 * Handle search photos request
 * GET /search?query=nature&page=1&per_page=10
 */
async function handleSearchPhotos(url: URL, env: Env, ctx: ExecutionContext): Promise<Response> {
  const query = url.searchParams.get('query');
  if (!query) {
    return jsonResponse({ error: 'Query parameter is required' }, 400);
  }

  const page = url.searchParams.get('page') || '1';
  const perPage = url.searchParams.get('per_page') || '10';
  const orientation = url.searchParams.get('orientation') || 'landscape';

  const unsplashUrl = new URL('https://api.unsplash.com/search/photos');
  unsplashUrl.searchParams.set('query', query);
  unsplashUrl.searchParams.set('page', page);
  unsplashUrl.searchParams.set('per_page', perPage);
  unsplashUrl.searchParams.set('orientation', orientation);
  unsplashUrl.searchParams.set('content_filter', 'high');

  const unsplashResponse = await fetch(unsplashUrl.toString(), {
    headers: {
      Authorization: `Client-ID ${env.UNSPLASH_ACCESS_KEY}`,
      'Accept-Version': 'v1',
      'User-Agent': 'vStats-Unsplash-Proxy',
    },
  });

  if (!unsplashResponse.ok) {
    const errorText = await unsplashResponse.text();
    console.error('Unsplash API error:', unsplashResponse.status, errorText);
    return jsonResponse({ error: 'Failed to search photos' }, 502);
  }

  const data = (await unsplashResponse.json()) as UnsplashSearchResult;

  const results = data.results.map((photo) => ({
    url: buildImageUrl(photo.urls.raw, 1920, 1080),
    thumbnail: buildImageUrl(photo.urls.raw, 400, 300),
    id: photo.id,
    description: photo.description || photo.alt_description,
    author: {
      name: photo.user.name,
      username: photo.user.username,
    },
    color: photo.color,
  }));

  return jsonResponse({
    total: data.total,
    total_pages: data.total_pages,
    results,
  });
}

/**
 * Build optimized image URL with Unsplash parameters
 */
function buildImageUrl(rawUrl: string, width: number, height: number): string {
  const url = new URL(rawUrl);
  url.searchParams.set('w', width.toString());
  url.searchParams.set('h', height.toString());
  url.searchParams.set('fit', 'crop');
  url.searchParams.set('auto', 'format,compress');
  url.searchParams.set('q', '80');
  return url.toString();
}

/**
 * Helper to create JSON response with CORS headers
 */
function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders,
    },
  });
}

// Type definitions for Unsplash API responses
interface UnsplashPhoto {
  id: string;
  description: string | null;
  alt_description: string | null;
  color: string;
  blur_hash: string;
  urls: {
    raw: string;
    full: string;
    regular: string;
    small: string;
    thumb: string;
  };
  links: {
    html: string;
    download: string;
    download_location: string;
  };
  user: {
    name: string;
    username: string;
    links: {
      html: string;
    };
  };
}

interface UnsplashSearchResult {
  total: number;
  total_pages: number;
  results: UnsplashPhoto[];
}
