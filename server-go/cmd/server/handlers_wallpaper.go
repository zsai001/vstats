package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// Wallpaper cache storage
type WallpaperCacheEntry struct {
	URL       string
	Timestamp time.Time
}

var (
	bingWallpaperCache       *WallpaperCacheEntry
	bingWallpaperCacheMu     sync.RWMutex
	unsplashWallpaperCache   = make(map[string]*WallpaperCacheEntry) // key: query
	unsplashWallpaperCacheMu sync.RWMutex
)

// ============================================================================
// Wallpaper Proxy Handlers (for Bing and Unsplash)
// ============================================================================

// GetBingWallpaper proxies the Bing daily wallpaper API to avoid CORS issues
// Cache duration: 24 hours (Bing updates daily)
func GetBingWallpaper(c *gin.Context) {
	// Check cache first (24 hour cache for daily wallpaper)
	bingWallpaperCacheMu.RLock()
	cached := bingWallpaperCache
	cacheValid := cached != nil && time.Since(cached.Timestamp) < 24*time.Hour
	bingWallpaperCacheMu.RUnlock()

	if cacheValid {
		c.JSON(http.StatusOK, gin.H{"url": cached.URL, "cached": true})
		return
	}

	client := &http.Client{
		Timeout: 10 * time.Second,
	}

	// Fetch Bing wallpaper API through server proxy
	apiURL := "https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1&mkt=en-US"
	resp, err := client.Get(apiURL)
	if err != nil {
		log.Printf("Error fetching Bing wallpaper API: %v", err)
		// If we have stale cache, return it even if expired
		if cached != nil {
			c.JSON(http.StatusOK, gin.H{"url": cached.URL, "cached": true, "stale": true})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "Failed to fetch Bing wallpaper",
			"message": "Unable to connect to Bing API",
		})
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		log.Printf("Bing API returned non-200 status: %d", resp.StatusCode)
		// If we have stale cache, return it even if expired
		if cached != nil {
			c.JSON(http.StatusOK, gin.H{"url": cached.URL, "cached": true, "stale": true})
			return
		}
		c.JSON(http.StatusBadGateway, gin.H{
			"error":   "Failed to fetch Bing wallpaper",
			"message": fmt.Sprintf("Bing API returned status %d", resp.StatusCode),
		})
		return
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		log.Printf("Error reading Bing API response: %v", err)
		if cached != nil {
			c.JSON(http.StatusOK, gin.H{"url": cached.URL, "cached": true, "stale": true})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "Failed to read response",
			"message": "Unable to read Bing API response",
		})
		return
	}

	var result struct {
		Images []struct {
			URL string `json:"url"`
		} `json:"images"`
	}

	if err := json.Unmarshal(body, &result); err != nil {
		log.Printf("Error parsing Bing API response: %v", err)
		if cached != nil {
			c.JSON(http.StatusOK, gin.H{"url": cached.URL, "cached": true, "stale": true})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "Failed to parse response",
			"message": "Invalid JSON response from Bing API",
		})
		return
	}

	if len(result.Images) == 0 || result.Images[0].URL == "" {
		log.Printf("Bing API returned empty images array")
		if cached != nil {
			c.JSON(http.StatusOK, gin.H{"url": cached.URL, "cached": true, "stale": true})
			return
		}
		c.JSON(http.StatusNotFound, gin.H{
			"error":   "No wallpaper found",
			"message": "Bing API did not return any images",
		})
		return
	}

	// Construct full image URL
	imageURL := "https://www.bing.com" + result.Images[0].URL

	// Update cache
	bingWallpaperCacheMu.Lock()
	bingWallpaperCache = &WallpaperCacheEntry{
		URL:       imageURL,
		Timestamp: time.Now(),
	}
	bingWallpaperCacheMu.Unlock()

	c.JSON(http.StatusOK, gin.H{"url": imageURL})
}

// Centralized Unsplash Proxy URL (Cloudflare Worker)
const UnsplashProxyURL = "https://vstats-unsplash-proxy.zsai001.workers.dev"

// UnsplashProxyResponse represents the response from unsplash proxy
type UnsplashProxyResponse struct {
	URL         string `json:"url"`
	ID          string `json:"id,omitempty"`
	Description string `json:"description,omitempty"`
	Fallback    bool   `json:"fallback,omitempty"`
	Author      *struct {
		Name     string `json:"name"`
		Username string `json:"username"`
		Link     string `json:"link"`
	} `json:"author,omitempty"`
	Color    string `json:"color,omitempty"`
	BlurHash string `json:"blur_hash,omitempty"`
}

// GetUnsplashWallpaper returns a random Unsplash image URL through centralized proxy
// Cache duration: 5 minutes (to avoid too frequent requests)
func GetUnsplashWallpaper(c *gin.Context) {
	query := c.DefaultQuery("query", "nature,landscape")
	orientation := c.DefaultQuery("orientation", "landscape")
	width := c.DefaultQuery("w", "1920")
	height := c.DefaultQuery("h", "1080")

	// Build cache key
	cacheKey := fmt.Sprintf("%s:%s:%s:%s", query, orientation, width, height)

	// Check cache first (5 minute cache)
	unsplashWallpaperCacheMu.RLock()
	cached, exists := unsplashWallpaperCache[cacheKey]
	cacheValid := exists && cached != nil && time.Since(cached.Timestamp) < 5*time.Minute
	unsplashWallpaperCacheMu.RUnlock()

	if cacheValid {
		c.JSON(http.StatusOK, gin.H{"url": cached.URL, "cached": true})
		return
	}

	// Call Unsplash Proxy
	client := &http.Client{
		Timeout: 15 * time.Second,
	}

	proxyURL := fmt.Sprintf("%s/random?query=%s&orientation=%s&w=%s&h=%s",
		UnsplashProxyURL,
		url.QueryEscape(query),
		url.QueryEscape(orientation),
		url.QueryEscape(width),
		url.QueryEscape(height),
	)

	resp, err := client.Get(proxyURL)
	if err != nil {
		log.Printf("Error fetching from Unsplash Proxy: %v", err)
		// Fallback to Picsum
		fallbackURL := fmt.Sprintf("https://picsum.photos/%s/%s", width, height)
		c.JSON(http.StatusOK, gin.H{"url": fallbackURL, "fallback": true})
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		log.Printf("Unsplash Proxy returned status: %d", resp.StatusCode)
		// Fallback to Picsum
		fallbackURL := fmt.Sprintf("https://picsum.photos/%s/%s", width, height)
		c.JSON(http.StatusOK, gin.H{"url": fallbackURL, "fallback": true})
		return
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		log.Printf("Error reading Unsplash Proxy response: %v", err)
		fallbackURL := fmt.Sprintf("https://picsum.photos/%s/%s", width, height)
		c.JSON(http.StatusOK, gin.H{"url": fallbackURL, "fallback": true})
		return
	}

	var proxyResp UnsplashProxyResponse
	if err := json.Unmarshal(body, &proxyResp); err != nil {
		log.Printf("Error parsing Unsplash Proxy response: %v", err)
		fallbackURL := fmt.Sprintf("https://picsum.photos/%s/%s", width, height)
		c.JSON(http.StatusOK, gin.H{"url": fallbackURL, "fallback": true})
		return
	}

	if proxyResp.URL == "" {
		log.Printf("Unsplash Proxy returned empty URL")
		fallbackURL := fmt.Sprintf("https://picsum.photos/%s/%s", width, height)
		c.JSON(http.StatusOK, gin.H{"url": fallbackURL, "fallback": true})
		return
	}

	// Update cache
	unsplashWallpaperCacheMu.Lock()
	unsplashWallpaperCache[cacheKey] = &WallpaperCacheEntry{
		URL:       proxyResp.URL,
		Timestamp: time.Now(),
	}
	unsplashWallpaperCacheMu.Unlock()

	// Return full response with author info if available
	response := gin.H{
		"url": proxyResp.URL,
	}
	if proxyResp.ID != "" {
		response["id"] = proxyResp.ID
	}
	if proxyResp.Author != nil {
		response["author"] = proxyResp.Author
	}
	if proxyResp.Color != "" {
		response["color"] = proxyResp.Color
	}
	if proxyResp.BlurHash != "" {
		response["blur_hash"] = proxyResp.BlurHash
	}
	if proxyResp.Fallback {
		response["fallback"] = true
	}

	c.JSON(http.StatusOK, response)
}

// GetCustomWallpaper validates a custom image URL and returns a proxy URL or direct URL
// For external URLs, returns a proxy URL that serves the image data
// Cache duration: 1 hour (for user-provided URLs)
func GetCustomWallpaper(c *gin.Context) {
	imageURL := c.Query("url")
	if imageURL == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "Missing URL parameter",
			"message": "URL parameter is required",
		})
		return
	}

	// Validate URL
	parsedURL, err := url.Parse(imageURL)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "Invalid URL",
			"message": "The provided URL is not valid",
		})
		return
	}

	// Only allow http and https protocols
	if parsedURL.Scheme != "http" && parsedURL.Scheme != "https" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "Invalid protocol",
			"message": "Only http and https protocols are allowed",
		})
		return
	}

	// Check if URL is same-origin (relative or same host)
	host := c.Request.Host
	sameOrigin := parsedURL.Host == "" || parsedURL.Host == host || strings.HasPrefix(parsedURL.Host, host+":")

	// For same-origin URLs, return directly
	if sameOrigin {
		c.JSON(http.StatusOK, gin.H{"url": imageURL, "proxy": false})
		return
	}

	// For external URLs, return proxy URL
	proxyURL := fmt.Sprintf("/api/wallpaper/proxy/image?url=%s", url.QueryEscape(imageURL))
	c.JSON(http.StatusOK, gin.H{"url": proxyURL, "proxy": true})
}

// GetCustomWallpaperImage proxies the actual image data to avoid CORS issues
func GetCustomWallpaperImage(c *gin.Context) {
	imageURL := c.Query("url")
	if imageURL == "" {
		c.Status(http.StatusBadRequest)
		return
	}

	// Validate URL
	parsedURL, err := url.Parse(imageURL)
	if err != nil {
		c.Status(http.StatusBadRequest)
		return
	}

	// Only allow http and https protocols
	if parsedURL.Scheme != "http" && parsedURL.Scheme != "https" {
		c.Status(http.StatusBadRequest)
		return
	}

	// Fetch the image through proxy
	client := &http.Client{
		Timeout: 15 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			// Follow up to 5 redirects
			if len(via) >= 5 {
				return fmt.Errorf("too many redirects")
			}
			return nil
		},
	}

	req, err := http.NewRequest("GET", imageURL, nil)
	if err != nil {
		log.Printf("Error creating request for custom wallpaper: %v", err)
		c.Status(http.StatusBadGateway)
		return
	}

	// Set user agent to avoid some blocking
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
	req.Header.Set("Referer", parsedURL.Scheme+"://"+parsedURL.Host+"/")

	resp, err := client.Do(req)
	if err != nil {
		log.Printf("Error fetching custom wallpaper: %v", err)
		c.Status(http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		log.Printf("Custom wallpaper URL returned status: %d", resp.StatusCode)
		c.Status(http.StatusBadGateway)
		return
	}

	// Copy headers
	contentType := resp.Header.Get("Content-Type")
	if contentType != "" {
		c.Header("Content-Type", contentType)
	}

	// Copy other useful headers
	if cacheControl := resp.Header.Get("Cache-Control"); cacheControl != "" {
		c.Header("Cache-Control", cacheControl)
	} else {
		// Set default cache for 1 hour
		c.Header("Cache-Control", "public, max-age=3600")
	}

	if etag := resp.Header.Get("ETag"); etag != "" {
		c.Header("ETag", etag)
	}

	if lastModified := resp.Header.Get("Last-Modified"); lastModified != "" {
		c.Header("Last-Modified", lastModified)
	}

	// Stream the image data
	if resp.ContentLength > 0 {
		c.DataFromReader(http.StatusOK, resp.ContentLength, contentType, resp.Body, nil)
	} else {
		// If content length is unknown, read all data
		body, err := io.ReadAll(resp.Body)
		if err != nil {
			c.Status(http.StatusBadGateway)
			return
		}
		c.Data(http.StatusOK, contentType, body)
	}
}
