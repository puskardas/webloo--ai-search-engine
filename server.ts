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
      if (sentence.length < 10) continue;
      const lowerSentence = sentence.toLowerCase();
      let matches = 0;
      for (const token of lowerTokens) {
        if (lowerSentence.includes(token)) matches++;
      }
      if (matches > maxMatches) {
        maxMatches = matches;
        bestSentence = sentence;
      }
    }

    if (!bestSentence) return content.substring(0, 200) + "...";
    
    // Limit length
    if (bestSentence.length > 250) {
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
    sortOrder?: "asc" | "desc"
  } = {}) {
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

    // 2. Filter by Boolean Constraints (AND / NOT)
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

    return {
      results: results.slice(offset, offset + limit),
      total: results.length
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
      topTerms,
      domainDist: Object.entries(domains).map(([name, value]) => ({ name, value }))
    };
  }
}

const engine = new SearchEngine();

// --- Crawler Logic ---

async function crawl(url: string, depth = 1, visited = new Set<string>()) {
  if (visited.has(url) || depth < 0) return;
  visited.add(url);

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
  app.get("/api/analytics", (req, res) => {
    res.json(engine.getAnalyticsData());
  });

  app.post("/api/crawl", async (req, res) => {
    const { url, depth = 1 } = req.body;
    if (!url) return res.status(400).json({ error: "URL is required" });
    
    console.log(`Starting crawl for ${url} (depth: ${depth})`);
    // Run in background
    crawl(url, depth).then(() => {
      console.log(`Finished crawling scope of ${url}`);
    });
    
    res.json({ message: "Crawl started" });
  });

  app.get("/api/search", (req, res) => {
    const { q, type, must, not, phrase, page, limit, sortBy, sortOrder } = req.query;
    
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
      sortOrder: sortOrder ? (String(sortOrder) as any) : undefined
    };

    const searchResponse = engine.search(q ? String(q) : "", options);
    res.json(searchResponse);
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
    const { q } = req.query;
    if (!q) return res.json([]);
    res.json(engine.getSuggestions(String(q)));
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

  const PORT = 3000;
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Search engine server running at http://localhost:${PORT}`);
  });
}

// Pre-seed with some pages if empty
(async () => {
  await engine.addDocument("https://en.wikipedia.org/wiki/Search_engine", "Search engine - Wikipedia", "A search engine is a software system that is designed to carry out web search (Internet search), which means to search the World Wide Web in a systematic way for particular information specified in a textual web search query.");
  await engine.addDocument("https://en.wikipedia.org/wiki/Inverted_index", "Inverted index - Wikipedia", "In computer science, an inverted index (also referred to as a postings file or index) is a database index storing a mapping from content, such as words or numbers, to its locations in a table, or in a document or a set of documents.");
  await engine.addDocument("https://en.wikipedia.org/wiki/Okapi_BM25", "Okapi BM25 - Wikipedia", "Okapi BM25 is a ranking function used by search engines to estimate the relevance of documents to a given search query.");
})();

startServer();
