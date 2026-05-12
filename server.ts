import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import * as cheerio from "cheerio";
import axios from "axios";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import natural from "natural";

const stemmer = natural.PorterStemmer;
const stopwords = new Set(["a", "an", "the", "and", "or", "but", "if", "then", "else", "when", "at", "from", "by", "for", "with", "about", "against", "between", "into", "through", "during", "before", "after", "above", "below", "to", "up", "down", "in", "out", "on", "off", "over", "under", "again", "further", "then", "once", "here", "there", "when", "where", "why", "how", "all", "any", "both", "each", "few", "more", "most", "other", "some", "such", "no", "nor", "not", "only", "own", "same", "so", "than", "too", "very", "s", "t", "can", "will", "just", "don", "should", "now"]);

// --- Search Engine Logic ---

interface Document {
  id: string;
  url: string;
  title: string;
  content: string;
  tokens: string[];
  stemmedTokens: string[];
  indexedAt: number;
  images: { url: string; alt: string; context: string }[];
}

class SearchEngine {
  private documents: Map<string, Document> = new Map();
  private imageIndex: { url: string; parentUrl: string; alt: string; context: string; features?: string }[] = [];
  private invertedIndex: Map<string, Set<string>> = new Map();
  private docLengths: Map<string, number> = new Map();
  private avgDocLength: number = 0;
  private status: string = "Idle";
  
  // BM25 parameters
  private readonly k1 = 1.2;
  private readonly b = 0.75;

  private tokenize(text: string): { original: string[], stemmed: string[] } {
    const rawTokens = text
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1);

    const filtered = rawTokens.filter(t => !stopwords.has(t));
    const stemmed = filtered.map(t => stemmer.stem(t));

    return { original: rawTokens, stemmed: stemmed };
  }

  public async addDocument(url: string, title: string, content: string, images: { url: string; alt: string; context: string }[] = []) {
    if (this.documents.has(url)) return;

    // Simple robots.txt check
    if (url.includes("/admin/") || url.includes("/private/") || url.includes("/login/")) {
      console.log(`[ROBOTS] Blocking craw of restricted URL: ${url}`);
      return;
    }

    const { original, stemmed } = this.tokenize(`${title} ${content}`);
    const docId = url;
    
    const doc: Document = {
      id: docId,
      url,
      title,
      content,
      tokens: original,
      stemmedTokens: stemmed,
      indexedAt: Date.now(),
      images
    };

    this.documents.set(docId, doc);
    this.docLengths.set(docId, stemmed.length);

    // Index images separately for image search
    for (const img of images) {
      this.imageIndex.push({
        ...img,
        parentUrl: url
      });
    }

    // Update inverted index using stemmed tokens
    for (const token of stemmed) {
      if (!this.invertedIndex.has(token)) {
        this.invertedIndex.set(token, new Set());
      }
      this.invertedIndex.get(token)!.add(docId);
    }

    // Update average document length
    const totalLength = Array.from(this.docLengths.values()).reduce((a, b) => a + b, 0);
    this.avgDocLength = totalLength / this.documents.size;
    
    console.log(`Indexed: ${url} (${stemmed.length} unique dimensions, ${images.length} images)`);
  }

  private getTermFrequency(term: string, docId: string): number {
    const doc = this.documents.get(docId);
    if (!doc) return 0;
    return doc.stemmedTokens.filter(t => t === term).length;
  }

  private getDocFrequency(term: string): number {
    return this.invertedIndex.get(term)?.size || 0;
  }

  private createSnippet(content: string, queryTokens: string[]): string {
    const sentences = content.split(/[.!?]+/).map(s => s.trim());
    const lowerTokens = queryTokens.map(t => t.toLowerCase());
    
    // Find sentence with most query matches
    let bestSentence = "";
    let maxMatches = -1;

    for (const sentence of sentences) {
      if (sentence.length < 15) continue;
      const lowerSentence = sentence.toLowerCase();
      let matches = 0;
      for (const token of lowerTokens) {
        if (lowerSentence.includes(token)) {
          matches += token.length > 3 ? 2 : 1; // Prioritize longer token matches
        }
      }
      if (matches > maxMatches) {
        maxMatches = matches;
        bestSentence = sentence;
      }
    }

    if (!bestSentence) {
      // If no good sentence found, try to find the first occurrence of any token
      for (const token of lowerTokens) {
        const idx = content.toLowerCase().indexOf(token);
        if (idx !== -1) {
          const start = Math.max(0, idx - 100);
          const end = Math.min(content.length, idx + 150);
          return (start > 0 ? "..." : "") + content.substring(start, end).trim() + "...";
        }
      }
      return content.substring(0, 250) + "...";
    }
    
    // Limit length and ensure it's around the match if it's very long
    if (bestSentence.length > 250) {
      // Find the first matching token in the best sentence to center the snippet
      let firstMatchIdx = -1;
      for (const token of lowerTokens) {
        const idx = bestSentence.toLowerCase().indexOf(token);
        if (idx !== -1) {
          firstMatchIdx = idx;
          break;
        }
      }
      
      if (firstMatchIdx !== -1) {
        const start = Math.max(0, firstMatchIdx - 100);
        const end = Math.min(bestSentence.length, start + 250);
        return (start > 0 ? "..." : "") + bestSentence.substring(start, end).trim() + "...";
      }
      
      return bestSentence.substring(0, 250) + "...";
    }
    return bestSentence + ".";
  }

  public search(query: string, options: { 
    mustTokens?: string[], 
    notTokens?: string[], 
    phrase?: string,
    limit?: number,
    offset?: number,
    sortBy?: "relevance" | "date" | "url",
    sortOrder?: "asc" | "desc",
    startDate?: number,
    endDate?: number,
    excludeDomains?: string[]
  } = {}) {
    const start = performance.now();
    const { stemmed: queryTokens } = this.tokenize(query);
    const limit = options.limit || 10;
    const offset = options.offset || 0;
    const sortBy = options.sortBy || "relevance";
    const sortOrder = options.sortOrder || "desc";
    const scores: Map<string, number> = new Map();

    // 1. Identify Candidate Documents
    let candidates: Set<string> = new Set();
    
    if (queryTokens.length > 0) {
      for (const term of queryTokens) {
        this.invertedIndex.get(term)?.forEach(id => candidates.add(id));
      }
    } else if (options.phrase) {
      const { stemmed: phraseTokens } = this.tokenize(options.phrase);
      if (phraseTokens.length > 0) {
        this.invertedIndex.get(phraseTokens[0])?.forEach(id => candidates.add(id));
      }
    } else if (options.mustTokens) {
      const firstMust = this.tokenize(options.mustTokens[0]).stemmed[0];
      if (firstMust) this.invertedIndex.get(firstMust)?.forEach(id => candidates.add(id));
    } else {
      return { results: [], total: 0 };
    }

    // 2. Filter by Boolean Constraints (AND / NOT / Date / Domain)
    const filteredCandidates = Array.from(candidates).filter(docId => {
      const doc = this.documents.get(docId)!;
      
      if (options.notTokens) {
        for (const notQuery of options.notTokens) {
          const { stemmed: tokens } = this.tokenize(notQuery);
          if (tokens.some(t => doc.stemmedTokens.includes(t))) return false;
        }
      }

      if (options.mustTokens) {
        for (const mustQuery of options.mustTokens) {
          const { stemmed: tokens } = this.tokenize(mustQuery);
          if (!tokens.every(t => doc.stemmedTokens.includes(t))) return false;
        }
      }

      if (options.startDate && doc.indexedAt < options.startDate) return false;
      if (options.endDate && doc.indexedAt > options.endDate) return false;

      if (options.excludeDomains && options.excludeDomains.length > 0) {
        try {
          const docDomain = new URL(doc.url).hostname;
          if (options.excludeDomains.some(d => docDomain.toLowerCase().includes(d.toLowerCase().trim()))) return false;
        } catch (e) {}
      }

      if (options.phrase) {
        if (!doc.content.toLowerCase().includes(options.phrase.toLowerCase())) return false;
      }

      return true;
    });

    // 3. Score candidates using BM25
    for (const docId of filteredCandidates) {
      let totalScore = 0;
      const scoringTokens = [...new Set([...queryTokens, ...(options.mustTokens ? options.mustTokens.flatMap(t => this.tokenize(t).stemmed) : [])])];
      
      for (const term of scoringTokens) {
        const df = this.getDocFrequency(term);
        if (df === 0) continue;

        const N = this.documents.size;
        const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);

        const tf = this.getTermFrequency(term, docId);
        const D = this.docLengths.get(docId) || 0;
        totalScore += idf * (tf * (this.k1 + 1)) / (tf + this.k1 * (1 - this.b + this.b * (D / this.avgDocLength)));
      }
      
      if (totalScore > 0 || filteredCandidates.length > 0) {
        scores.set(docId, totalScore);
      }
    }

    const allTokens = [...queryTokens, ...(options.phrase ? this.tokenize(options.phrase).original : [])];

    const results = Array.from(scores.entries())
      .map(([docId, score]) => {
        const doc = this.documents.get(docId)!;
        return {
          url: doc.url,
          title: doc.title,
          snippet: this.createSnippet(doc.content, allTokens),
          score: score,
          indexedAt: doc.indexedAt
        };
      });

    results.sort((a, b) => {
      let comparison = 0;
      if (sortBy === "relevance") {
        comparison = b.score - a.score;
      } else if (sortBy === "date") {
        comparison = b.indexedAt - a.indexedAt;
      } else if (sortBy === "url") {
        comparison = a.url.localeCompare(b.url);
      }
      return sortOrder === "desc" ? comparison : -comparison;
    });

    const executionTime = performance.now() - start;

    return {
      results: results.slice(offset, offset + limit),
      total: results.length,
      metrics: {
        totalTime: executionTime,
        retrievalTime: 0, // Simplified for now
        rankingTime: 0
      }
    };
  }

  public searchImages(query: string, limit = 20) {
    const { stemmed: queryTokens } = this.tokenize(query);
    if (queryTokens.length === 0) return [];

    // Simple keyword matching for images (searching alt text, context, and features)
    const scoredImages = this.imageIndex.map(img => {
      let score = 0;
      const combinedText = `${img.alt} ${img.context} ${img.features || ""}`.toLowerCase();
      
      for (const token of queryTokens) {
        // Very basic scoring: keyword matches
        if (combinedText.includes(token)) score += 1;
        // Alt text weight
        if (img.alt.toLowerCase().includes(token)) score += 2;
      }
      
      return { ...img, score };
    }).filter(img => img.score > 0)
      .sort((a, b) => b.score - a.score);

    return scoredImages.slice(0, limit);
  }

  public updateImageFeatures(url: string, features: string) {
    for (const img of this.imageIndex) {
      if (img.url === url) {
        img.features = features;
      }
    }
  }

  public updateImageAlt(url: string, alt: string) {
    for (const img of this.imageIndex) {
      if (img.url === url) {
        img.alt = alt;
      }
    }
  }

  public getSuggestions(prefix: string) {
    if (!prefix || prefix.length < 2) return [];
    const p = prefix.toLowerCase();
    const suggestions: string[] = [];
    
    // We can use unique tokens from the doc collection or inverted index keys
    // For performance, just iterate index if it's small, or pre-sort them
    for (const term of this.invertedIndex.keys()) {
      if (term.startsWith(p)) {
        suggestions.push(term);
        if (suggestions.length >= 5) break;
      }
    }
    return suggestions;
  }

  public getStats() {
    return {
      documents: this.documents.size,
      terms: this.invertedIndex.size,
      images: this.imageIndex.length
    };
  }

  public getAnalyticsData() {
    // Top 10 terms
    const termFreqs: { term: string, count: number }[] = [];
    for (const [term, docs] of this.invertedIndex.entries()) {
      termFreqs.push({ term, count: docs.size });
    }
    const topTerms = termFreqs.sort((a, b) => b.count - a.count).slice(0, 10);

    // Domain distribution
    const domains: Record<string, number> = {};
    for (const url of this.documents.keys()) {
      try {
        const domain = new URL(url).hostname;
        domains[domain] = (domains[domain] || 0) + 1;
      } catch (e) {}
    }

    return {
      ...this.getStats(),
      status: this.status,
      topTerms,
      domainDist: Object.entries(domains).map(([name, value]) => ({ name, value }))
    };
  }

  public setStatus(s: string) {
    this.status = s;
    if (s !== "Idle") {
      console.log(`[STATUS] ${s}`);
    }
  }

  public clear() {
    this.documents.clear();
    this.imageIndex = [];
    this.invertedIndex.clear();
    this.docLengths.clear();
    this.avgDocLength = 0;
    console.log("Search engine index cleared.");
  }
}

const engine = new SearchEngine();

// --- Crawler Logic ---

const SEED_URLS = [
  "https://en.wikipedia.org/wiki/Web_crawler",
  "https://en.wikipedia.org/wiki/Information_retrieval",
  "https://developer.mozilla.org/en-US/docs/Web/HTTP",
  "https://github.com/trending"
];

async function automateDiscovery() {
  console.log("[AUTO] Starting automated discovery sequence...");
  for (const url of SEED_URLS) {
    if (engine.getStats().documents > 100) break; // Don't over-crawl automatically
    try {
      await crawl(url, 1, new Set());
    } catch (e) {
      console.error(`[AUTO] Discovery failed for ${url}:`, e);
    }
  }
  console.log("[AUTO] Discovery sequence finalized.");
  engine.setStatus("Idle");
}

async function startAutoMaintenance() {
  // Re-crawl a random existing domain every 2 hours to keep fresh
  setInterval(async () => {
    const stats = engine.getAnalyticsData();
    if (stats.domainDist.length > 0) {
      const randomDomain = stats.domainDist[Math.floor(Math.random() * stats.domainDist.length)].name;
      const existingDocs = Array.from((engine as any).documents.values()) as Document[];
      const domainDoc = existingDocs.find(d => d.url.includes(randomDomain));
      if (domainDoc) {
        console.log(`[MAINTENANCE] Refreshing ${randomDomain}...`);
        await crawl(domainDoc.url, 0, new Set());
      }
    }
  }, 1000 * 60 * 60 * 2); 
}

async function crawl(url: string, depth = 1, visited = new Set<string>()) {
  if (visited.has(url) || depth < 0) return;
  visited.add(url);

  engine.setStatus(`Crawling: ${url}`);
  try {
    const response = await axios.get(url, {
      timeout: 5000,
      headers: { 'User-Agent': 'MiniSearchEngineBot / 1.0' }
    });
    const $ = cheerio.load(response.data);

    // Filter out scripts, styles, etc.
    $('script, style, nav, footer').remove();

    const title = $('title').text() || url;
    const bodyText = $('body').text().replace(/\s+/g, ' ').trim();

    const images: { url: string; alt: string; context: string }[] = [];
    $('img[src]').each((_, el) => {
      const src = $(el).attr('src');
      if (src) {
        try {
          const absoluteImgUrl = new URL(src, url).href;
          const alt = $(el).attr('alt') || "";
          const context = $(el).parent().text().substring(0, 100).trim();
          images.push({ url: absoluteImgUrl, alt, context });
        } catch (e) {}
      }
    });

    await engine.addDocument(url, title, bodyText, images);

    if (depth > 0) {
      const links: string[] = [];
      $('a[href]').each((_, el) => {
        let href = $(el).attr('href');
        if (href) {
          try {
            const absoluteUrl = new URL(href, url).href;
            // Only follow same domain maybe? Or just limit
            if (absoluteUrl.startsWith('http') && !visited.has(absoluteUrl)) {
              links.push(absoluteUrl);
            }
          } catch (e) {}
        }
      });

      // Limit concurrent crawls
      for (const link of links.slice(0, 5)) {
        await crawl(link, depth - 1, visited);
      }
    }
  } catch (err) {
    console.error(`Error crawling ${url}:`, err instanceof Error ? err.message : String(err));
  }
}

// --- Server Setup ---

async function startServer() {
  const app = express();
  app.use(express.json());

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", timestamp: Date.now() });
  });

  app.get("/api/analytics", (req, res) => {
    try {
      res.json(engine.getAnalyticsData());
    } catch (err) {
      console.error("Analytics error:", err);
      res.status(500).json({ error: "Failed to collect analytics" });
    }
  });

  // Alias for analytics
  app.get("/api/stats", (req, res) => {
    try {
      res.json(engine.getAnalyticsData());
    } catch (err) {
      res.status(500).json({ error: "Failed to collect stats" });
    }
  });

  app.post("/api/crawl", async (req, res) => {
    const { url, depth = 1 } = req.body;
    if (!url) return res.status(400).json({ error: "URL is required" });
    
    console.log(`Starting crawl for ${url} (depth: ${depth})`);
    // Run in background
    engine.setStatus(`Preparing crawl for ${url}...`);
    crawl(url, depth).then(() => {
      console.log(`Finished crawling scope of ${url}`);
      engine.setStatus("Idle");
    }).catch(err => {
      console.error(`Crawl failed for ${url}:`, err);
      engine.setStatus("Idle");
    });
    
    res.json({ message: "Crawl started" });
  });

  app.post("/api/clear", (req, res) => {
    try {
      engine.clear();
      res.json({ message: "Cache cleared successfully" });
    } catch (err) {
      console.error("Clear error:", err);
      res.status(500).json({ error: "Failed to clear search index" });
    }
  });

  app.get("/api/search", (req, res) => {
    try {
      const { q, type, must, not, phrase, page, limit, sortBy, sortOrder, start, end, exclude } = req.query;
      
      const p = parseInt(String(page)) || 1;
      const l = parseInt(String(limit)) || 10;
      const offset = (p - 1) * l;

      if (type === "image") {
        const results = engine.searchImages(q ? String(q) : "");
        return res.json({ results, total: results.length });
      }

      // Parse complex queries if provided
      const options = {
        mustTokens: must ? String(must).split(",") : undefined,
        notTokens: not ? String(not).split(",") : undefined,
        phrase: phrase ? String(phrase) : undefined,
        limit: l,
        offset: offset,
        sortBy: sortBy ? (String(sortBy) as any) : undefined,
        sortOrder: sortOrder ? (String(sortOrder) as any) : undefined,
        startDate: start ? parseInt(String(start)) : undefined,
        endDate: end ? parseInt(String(end)) : undefined,
        excludeDomains: exclude ? String(exclude).split(",") : undefined
      };

      const searchResponse = engine.search(q ? String(q) : "", options);
      res.json(searchResponse);
    } catch (err) {
      console.error("Search error:", err);
      res.status(500).json({ error: "Search failed" });
    }
  });

  app.post("/api/image/features", (req, res) => {
    const { url, features } = req.body;
    if (!url || !features) return res.status(400).json({ error: "URL and features are required" });
    engine.updateImageFeatures(url, features);
    res.json({ message: "Features updated" });
  });

  app.post("/api/image/update-alt", (req, res) => {
    const { url, alt } = req.body;
    if (!url || alt === undefined) return res.status(400).json({ error: "URL and alt are required" });
    engine.updateImageAlt(url, alt);
    res.json({ message: "Alt text updated successfully" });
  });

  app.get("/api/suggest", (req, res) => {
    try {
      const { q } = req.query;
      if (!q) return res.json([]);
      res.json(engine.getSuggestions(String(q)));
    } catch (err) {
      res.json([]);
    }
  });

  // Catch all for unmatched API routes
  app.all("/api/*", (req, res) => {
    res.status(404).json({ error: "API route not found" });
  });

  // Vite/Static serving
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.resolve(distPath, "index.html"));
    });
  }

  // Error handler middleware
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error("Unhandled Express error:", err);
    if (res.headersSent) {
      return next(err);
    }
    res.status(500).json({ error: "Internal Server Error", details: err.message });
  });

  const PORT = 3000;
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Search engine server running at http://localhost:${PORT}`);
  });
}

// Pre-seed with some pages if empty
const seedData = async () => {
  try {
    await engine.addDocument("https://en.wikipedia.org/wiki/Search_engine", "Search engine - Wikipedia", "A search engine is a software system that is designed to carry out web search (Internet search), which means to search the World Wide Web in a systematic way for particular information specified in a textual web search query.");
    await engine.addDocument("https://en.wikipedia.org/wiki/Inverted_index", "Inverted index - Wikipedia", "In computer science, an inverted index (also referred to as a postings file or index) is a database index storing a mapping from content, such as words or numbers, to its locations in a table, or in a document or a set of documents.");
    await engine.addDocument("https://en.wikipedia.org/wiki/Okapi_BM25", "Okapi BM25 - Wikipedia", "Okapi BM25 is a ranking function used by search engines to estimate the relevance of documents to a given search query.");
    console.log("Seeding completed successfully.");
  } catch (err) {
    console.error("Seeding failed:", err);
  }
};

startServer().then(() => {
  seedData().then(() => {
    automateDiscovery();
    startAutoMaintenance();
  });
}).catch(err => {
  console.error("Failed to start server:", err);
});
