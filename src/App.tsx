import React, { useState, useEffect } from "react";
import { Search, Globe, Database, Settings, ChevronRight, Loader2, Plus, Info, Activity, BarChart3, Layout, ChevronLeft, Image as ImageIcon, Upload, X, Moon, Sun, LogIn, LogOut, Shield, Users, UserPlus, UserMinus, Trash2, CheckCircle, Clock } from "lucide-react";
import { GoogleGenAI } from "@google/genai";
import { motion, AnimatePresence } from "motion/react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, User, signOut } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc, getDocs, collection, deleteDoc, query, orderBy, serverTimestamp, arrayUnion, arrayRemove, addDoc, limit } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

interface SearchResult {
  url: string;
  title: string;
  snippet: string;
  score: number;
  indexedAt: number;
}

interface Stats {
  documents: number;
  terms: number;
  images: number;
  topTerms: { term: string, count: number }[];
  domainDist: { name: string, value: number }[];
}

interface ImageResult {
  url: string;
  parentUrl: string;
  alt: string;
  context: string;
  score: number;
}

interface AppUser {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string;
  lastLogin: any;
}

interface AdminUser {
  uid: string;
  email: string;
  displayName: string;
  addedAt: any;
}

interface AuditLog {
  id: string;
  adminId: string;
  adminEmail: string;
  action: string;
  timestamp: any;
  targetId?: string;
  details?: string;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [allUsers, setAllUsers] = useState<AppUser[]>([]);
  const [allAdmins, setAllAdmins] = useState<AdminUser[]>([]);
  const [allLogs, setAllLogs] = useState<AuditLog[]>([]);
  const [isLoadingAdmins, setIsLoadingAdmins] = useState(false);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  const [darkMode, setDarkMode] = useState(() => {
    return localStorage.getItem("theme") === "dark";
  });

  const [query, setQuery] = useState("");
  const [searchType, setSearchType] = useState<"text" | "image">("text");
  const [imageResults, setImageResults] = useState<ImageResult[]>([]);
  const [selectedImage, setSelectedImage] = useState<{ base64: string; name: string } | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [mustWords, setMustWords] = useState("");
  const [notWords, setNotWords] = useState("");
  const [phrase, setPhrase] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [totalResults, setTotalResults] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [resultsPerPage] = useState(10);
  const [isSearching, setIsSearching] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [crawlUrl, setCrawlUrl] = useState("");
  const [crawlDepth, setCrawlDepth] = useState(1);
  const [isCrawling, setIsCrawling] = useState(false);
  const [showCrawler, setShowCrawler] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [sortBy, setSortBy] = useState<"relevance" | "date" | "url">("relevance");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [view, setView] = useState<"search" | "dashboard" | "admins" | "audit">("search");
  const [viewImage, setViewImage] = useState<ImageResult | null>(null);
  const [editingAlt, setEditingAlt] = useState("");
  const [isUpdatingAlt, setIsUpdatingAlt] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("theme");
    const isDark = saved === "dark" || (!saved && window.matchMedia("(pre-hooks/color-scheme: dark)").matches);
    setDarkMode(isDark);
  }, []);

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add("dark");
      localStorage.setItem("theme", "dark");
    } else {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("theme", "light");
    }
  }, [darkMode]);

  useEffect(() => {
    if (results.length > 0 || imageResults.length > 0) {
      setHasSearched(true);
    }
  }, [results.length, imageResults.length]);

  useEffect(() => {
    if (viewImage) {
      setEditingAlt(viewImage.alt || "");
    }
  }, [viewImage]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        // 1. Immediately determine admin status
        const rawEmail = u.email || "";
        const trimmedEmail = rawEmail.toLowerCase().trim();
        console.log("Checking admin status for:", trimmedEmail);
        
        const isSuperAdmin = trimmedEmail === "puskardasofficial@gmail.com";
        if (isSuperAdmin) {
          console.log("Super Admin Identified");
          setIsAdmin(true);
        }

        // 2. Perform sync operations
        try {
          // Save user profile
          const userRef = doc(db, "users", u.uid);
          await setDoc(userRef, {
            uid: u.uid,
            email: u.email,
            displayName: u.displayName,
            photoURL: u.photoURL,
            lastLogin: serverTimestamp()
          }, { merge: true });

          if (isSuperAdmin) {
            // Ensure super admin is in the admins collection
            const adminRef = doc(db, "admins", u.uid);
            const adminSnap = await getDoc(adminRef);
            if (!adminSnap.exists()) {
              await setDoc(adminRef, {
                email: rawEmail,
                displayName: u.displayName || "Super Admin",
                addedAt: serverTimestamp()
              });
            }
          } else {
            // Regular user: check admins collection
            const adminDoc = await getDoc(doc(db, "admins", u.uid));
            setIsAdmin(adminDoc.exists());
          }
        } catch (e) {
          console.error("Auth sync operations failed:", e);
          // If the getDoc failed for a regular user, they are not an admin
          if (!isSuperAdmin) setIsAdmin(false);
        }
      } else {
        setIsAdmin(false);
      }
    });
    return () => unsub();
  }, []);

  const logAdminAction = async (action: string, targetId?: string, details?: string) => {
    if (!user) return;
    try {
      await addDoc(collection(db, "audit_logs"), {
        adminId: user.uid,
        adminEmail: user.email,
        action,
        timestamp: serverTimestamp(),
        targetId,
        details
      });
    } catch (err) {
      console.error("Failed to log admin action", err);
    }
  };

  const fetchAdminData = async () => {
    if (!isAdmin) return;
    setIsLoadingAdmins(true);
    setIsLoadingLogs(true);
    try {
      const adminsSnap = await getDocs(collection(db, "admins"));
      const adminsList = adminsSnap.docs.map(d => ({ uid: d.id, ...(d.data() as any) } as AdminUser));
      setAllAdmins(adminsList);

      const usersSnap = await getDocs(query(collection(db, "users"), orderBy("lastLogin", "desc")));
      const usersList = usersSnap.docs.map(d => d.data() as AppUser);
      setAllUsers(usersList);

      const logsSnap = await getDocs(query(collection(db, "audit_logs"), orderBy("timestamp", "desc"), limit(50)));
      const logsList = logsSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) } as AuditLog));
      setAllLogs(logsList);
    } catch (err) {
      console.error("Failed to fetch admin data", err);
    } finally {
      setIsLoadingAdmins(false);
      setIsLoadingLogs(false);
    }
  };

  useEffect(() => {
    if (view === "admins" || view === "audit") {
      fetchAdminData();
    }
  }, [view]);

  const toggleAdmin = async (targetUser: AppUser) => {
    const isCurrentlyAdmin = allAdmins.some(a => a.uid === targetUser.uid);
    try {
      if (isCurrentlyAdmin) {
        // Don't allow removing the super admin
        if (targetUser.email === "puskardasofficial@gmail.com") return;
        await deleteDoc(doc(db, "admins", targetUser.uid));
        await logAdminAction("REVOKE_ADMIN", targetUser.uid, `Revoked admin access for ${targetUser.email}`);
      } else {
        await setDoc(doc(db, "admins", targetUser.uid), {
          email: targetUser.email,
          displayName: targetUser.displayName,
          addedAt: serverTimestamp()
        });
        await logAdminAction("GRANT_ADMIN", targetUser.uid, `Granted admin access to ${targetUser.email}`);
      }
      fetchAdminData();
    } catch (err) {
      console.error("Failed to toggle admin status", err);
    }
  };

  const handleUpdateAlt = async () => {
    if (!viewImage) return;
    setIsUpdatingAlt(true);
    try {
      const res = await fetch("/api/image/update-alt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: viewImage.url, alt: editingAlt }),
      });
      if (res.ok) {
        // Update local results to reflect change
        setImageResults(prev => prev.map(img => 
          img.url === viewImage.url ? { ...img, alt: editingAlt } : img
        ));
        await logAdminAction("UPDATE_IMAGE_ALT", undefined, `Updated alt text for ${viewImage.url}`);
        setViewImage({ ...viewImage, alt: editingAlt });
      }
    } catch (err) {
      console.error("Failed to update alt text", err);
    } finally {
      setIsUpdatingAlt(false);
    }
  };

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, provider);
    } catch (err) {
      console.error("Login failed", err);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setView("search");
    } catch (err) {
      console.error("Logout failed", err);
    }
  };

  const fetchSuggestions = async (val: string) => {
    if (val.length < 2) {
      setSuggestions([]);
      return;
    }
    try {
      const res = await fetch(`/api/suggest?q=${encodeURIComponent(val)}`);
      const data = await res.json();
      setSuggestions(data);
    } catch (err) {
      console.error("Failed to fetch suggestions", err);
    }
  };

  const handleQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    fetchSuggestions(val);
    setShowSuggestions(true);
  };

  const [searchTime, setSearchTime] = useState<number>(0);

  const fetchStats = async () => {
    try {
      const res = await fetch("/api/analytics");
      const data = await res.json();
      setStats(data);
    } catch (err) {
      console.error("Failed to fetch stats", err);
    }
  };

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 5000);
    return () => clearInterval(interval);
  }, []);

  const [searchHistory, setSearchHistory] = useState<string[]>([]);

  useEffect(() => {
    const saved = localStorage.getItem("search_history");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) setSearchHistory(parsed as string[]);
      } catch (e) {
        console.error("Failed to parse history", e);
      }
    }
  }, []);

  const addToHistory = (q: string) => {
    if (!q.trim()) return;
    const newHistory = [q, ...searchHistory.filter(h => h !== q)].slice(0, 10);
    setSearchHistory(newHistory);
    localStorage.setItem("search_history", JSON.stringify(newHistory));
  };

  const clearHistory = () => {
    setSearchHistory([]);
    localStorage.removeItem("search_history");
  };

  useEffect(() => {
    if (results.length > 0 || query.trim()) {
      handleSearch(undefined, 1);
    }
  }, [sortBy, sortOrder]);

  const handleSearch = async (e?: React.FormEvent, page = 1, overrideQuery?: string, overrideMust?: string) => {
    if (e) e.preventDefault();
    const activeQuery = overrideQuery !== undefined ? overrideQuery : query;
    const activeMust = overrideMust !== undefined ? overrideMust : mustWords;
    if (!activeQuery.trim() && !activeMust.trim() && !phrase.trim()) return;
    
    setIsSearching(true);
    setShowSuggestions(false);
    setCurrentPage(page);
    if (!hasSearched) setHasSearched(true);
    if (activeQuery.trim()) addToHistory(activeQuery.trim());
    
    const start = performance.now();
    try {
      const params = new URLSearchParams();
      if (activeQuery) params.append("q", activeQuery);
      if (activeMust) params.append("must", activeMust.split(" ").join(","));
      if (notWords) params.append("not", notWords.split(" ").join(","));
      if (phrase) params.append("phrase", phrase);
      params.append("page", String(page));
      params.append("limit", String(resultsPerPage));
      params.append("sortBy", sortBy);
      params.append("sortOrder", sortOrder);
      params.append("type", searchType);
      
      const res = await fetch(`/api/search?${params.toString()}`);
      const data = await res.json();

      if (searchType === "image") {
        setImageResults(data.results || []);
      } else {
        setResults(data.results || []);
        setTotalResults(data.total || 0);
      }
      setSearchTime((performance.now() - start) / 1000);
    } catch (err) {
      console.error("Search failed", err);
    } finally {
      setIsSearching(false);
    }
  };

  const analyzeImage = async (base64: string) => {
    setIsAnalyzing(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const prompt = "Analyze this image and provide a detailed set of search keywords and descriptions that capture its visual features, objects, colors, and style. The output should be a space-separated list of terms suitable for a search engine query.";
      
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: {
          parts: [
            { text: prompt },
            { inlineData: { data: base64.split(",")[1], mimeType: "image/jpeg" } }
          ]
        }
      });
      
      const visualFeatures = response.text;
      if (visualFeatures) {
        setQuery(visualFeatures);
        setSearchType("image");
        handleSearch(undefined, 1, visualFeatures);
      }
    } catch (err) {
      console.error("Image analysis failed", err);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleMoreLikeThis = async (img: ImageResult) => {
    if (!img) return;
    setIsAnalyzing(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const prompt = `Based on the following image information, generate a highly effective search query (3-5 keywords) to find visually similar images. Only output the keywords.
      
      Alt Text: ${img.alt || "N/A"}
      Context Snippet: ${img.context || "N/A"}`;
      
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: { parts: [{ text: prompt }] }
      });
      
      const smartQuery = response.text?.trim() || `${img.alt} ${img.context}`.trim();
      setQuery(smartQuery);
      setSearchType("image");
      setViewImage(null);
      handleSearch(undefined, 1, smartQuery);
    } catch (err) {
      console.error("Smart more like this failed, falling back to basic extraction", err);
      const fallbackQuery = `${img.alt} ${img.context}`.trim();
      if (!fallbackQuery) return;
      setQuery(fallbackQuery);
      setSearchType("image");
      setViewImage(null);
      handleSearch(undefined, 1, fallbackQuery);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result as string;
        setSelectedImage({ base64, name: file.name });
        analyzeImage(base64);
      };
      reader.readAsDataURL(file);
    }
  };

  const totalPages = Math.ceil(totalResults / resultsPerPage);

  const handleCrawl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!crawlUrl.trim()) return;
    setIsCrawling(true);
    try {
      await fetch("/api/crawl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: crawlUrl, depth: crawlDepth }),
      });
      await logAdminAction("INITIATE_CRAWL", undefined, `Started indexing from ${crawlUrl} (depth: ${crawlDepth})`);
      setCrawlUrl("");
      setCrawlDepth(1);
      setShowCrawler(false);
    } catch (err) {
      console.error("Crawl request failed", err);
    } finally {
      setIsCrawling(false);
      setTimeout(fetchStats, 1000);
    }
  };

  const GoogleLogo = ({ size = "text-6xl" }: { size?: string }) => {
    const letters = [
      { char: 'M', color: 'text-blue-500' },
      { char: 'i', color: 'text-red-500' },
      { char: 'n', color: 'text-yellow-500' },
      { char: 'i', color: 'text-blue-500' },
      { char: 'S', color: 'text-green-500' },
      { char: 'e', color: 'text-red-500' },
      { char: 'a', color: 'text-blue-500' },
      { char: 'r', color: 'text-red-500' },
      { char: 'c', color: 'text-yellow-500' },
      { char: 'h', color: 'text-blue-500' },
    ];

    return (
      <div className={`flex font-bold ${size} tracking-tighter select-none`}>
        {letters.map((l, i) => (
          <span key={i} className={darkMode ? 'text-white' : l.color}>
            {l.char}
          </span>
        ))}
      </div>
    );
  };
  const highlightText = (text: string, queries: string[]): JSX.Element | string => {
    if (!queries.length || !text) return text;
    
    // Escape special characters in tokens for regex
    const escapeRegExp = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    
    // Filter and sort by length descending to ensure longest matches are prioritized
    const sortedTokens = Array.from(new Set(queries))
      .filter(q => q && q.length > 1)
      .sort((a, b) => b.length - a.length)
      .map(escapeRegExp);

    if (sortedTokens.length === 0) return text;
    
    const pattern = new RegExp(`(${sortedTokens.join("|")})`, "gi");
    const parts = text.split(pattern);
    
    return (
      <>
        {parts.map((part, i) => {
          // Check if this part matches any of our escaped tokens exactly (case-insensitive)
          const isMatch = sortedTokens.some(token => 
            new RegExp(`^${token}$`, 'i').test(part)
          );
          return isMatch ? (
            <mark key={i} className="bg-yellow-200 dark:bg-yellow-800 text-slate-900 dark:text-slate-100 px-0.5 rounded font-medium">
              {part}
            </mark>
          ) : (
            part
          );
        })}
      </>
    );
  };

  const getCombinedQueryTokens = (): string[] => {
    const tokens: string[] = [];
    
    // Helper to add unique tokens
    const addTokens = (str: string) => {
      if (!str) return;
      // Split by whitespace and non-word characters for basic tokens
      tokens.push(...str.split(/[\s\W]+/).filter(t => t.length > 1));
    };

    // 1. Primary Query
    addTokens(query);
    
    // 2. Advanced Filters
    addTokens(mustWords);
    addTokens(notWords);
    if (phrase && phrase.trim().length > 1) {
      tokens.push(phrase.trim()); // The whole phrase
    }

    // 3. Search History (Last 5 searches)
    searchHistory.slice(0, 5).forEach(h => {
      addTokens(h);
    });

    // Remove duplicates and filter empty
    return Array.from(new Set(tokens)).filter(t => t.length > 1);
  };

  return (
    <div className="h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200 font-sans transition-colors duration-300 overflow-hidden" onClick={() => setShowSuggestions(false)}>
      {/* Header - Minimal unless on Results page */}
      <header className={`bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-6 py-3 flex items-center justify-between shrink-0 transition-all duration-500 ${!hasSearched ? 'bg-transparent border-transparent' : ''}`}>
        <div className={`flex items-center space-x-3 transition-opacity duration-500 ${!hasSearched ? 'opacity-0' : 'opacity-100'}`}>
          <div onClick={() => setHasSearched(false)} className="cursor-pointer group flex items-center gap-2">
            <GoogleLogo size="text-2xl" />
            <span className="text-blue-600 font-medium text-[10px] tracking-widest uppercase mt-1">Engine</span>
          </div>
        </div>

        <div className="flex items-center space-x-4">
          {isAdmin && (
            <div className="hidden sm:flex items-center gap-2 bg-emerald-50 dark:bg-emerald-950/20 px-3 py-1.5 rounded-full border border-emerald-100 dark:border-emerald-900/30">
              <Shield className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-widest">Admin Mode</span>
            </div>
          )}

          <button
            onClick={(e) => {
              e.stopPropagation();
              setDarkMode(!darkMode);
            }}
            className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 transition-all"
            title={darkMode ? "Switch to Light Mode" : "Switch to Dark Mode"}
          >
            {darkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          </button>

            {user ? (
              <div className="flex items-center space-x-3 pl-2 border-l border-slate-200 dark:border-slate-800">
                <div className="text-right hidden sm:block">
                  <p className="text-[10px] font-bold text-slate-800 dark:text-slate-100 uppercase tracking-tighter leading-tight">{user.displayName || 'User'}</p>
                  <p className="text-[9px] text-slate-400 dark:text-slate-500 uppercase font-bold tracking-widest leading-tight">
                    {isAdmin ? "Administrator" : "Guest User"}
                  </p>
                </div>
                {user.photoURL ? (
                  <img src={user.photoURL} className="w-8 h-8 rounded-full border border-slate-200 dark:border-slate-700 shadow-sm" alt="Profile" />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center text-blue-600 dark:text-blue-400">
                    <LogIn className="w-4 h-4" />
                  </div>
                )}
                <button 
                  onClick={handleLogout}
                  className="p-1 px-2 text-[10px] font-bold uppercase text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 rounded transition-colors"
                >
                  Logout
                </button>
              </div>
            ) : (
              <button 
                onClick={handleLogin}
                className="flex items-center gap-2 bg-slate-800 dark:bg-blue-600 hover:bg-slate-900 dark:hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-xs font-bold transition-all shadow-sm"
              >
                <LogIn className="w-4 h-4" />
                Sign In
              </button>
            ) }

            {isAdmin && (
              <div className="flex gap-2">
                <button 
                  onClick={() => setView(view === "dashboard" ? "search" : "dashboard")}
                  className={`px-4 py-2 rounded-lg text-xs font-bold transition-all shadow-sm flex items-center gap-2 ${
                    view === "dashboard" || view === "admins" || view === "audit"
                      ? "bg-emerald-600 text-white" 
                      : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200"
                  }`}
                >
                  <Layout className="w-4 h-4" />
                  Admin Panel
                </button>
                <button 
                  onClick={() => setShowCrawler(!showCrawler)}
                  className="bg-blue-600 dark:bg-blue-600 text-white px-4 py-2 rounded-lg text-xs font-bold hover:bg-blue-700 transition-all shadow-sm flex items-center gap-2"
                >
                  <Globe className="w-4 h-4" />
                  Crawler
                </button>
              </div>
            )}
        </div>
      </header>

      {/* Main Grid Interface */}
      <main className="flex-1 grid grid-cols-1 md:grid-cols-12 gap-6 p-4 md:p-6 overflow-hidden">
        
        {/* Left Sidebar - Stats & System */}
        {isAdmin && view === "search" && hasSearched && (
          <aside className="col-span-1 md:col-span-3 flex flex-col space-y-6 overflow-y-auto pr-2 custom-scrollbar">
            {/* View Switcher */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-1 shadow-sm flex rounded-lg shrink-0">
            <button 
              onClick={() => setView("search")}
              className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all ${
                view === "search" 
                  ? "bg-slate-800 dark:bg-blue-600 text-white shadow-md" 
                  : "text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
              }`}
            >
              <Search className="w-3.5 h-3.5" />
              Search
            </button>
            <button 
              onClick={() => setView("dashboard")}
              className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all ${
                view === "dashboard" 
                  ? "bg-slate-800 dark:bg-blue-600 text-white shadow-md" 
                  : "text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
              }`}
            >
              <BarChart3 className="w-3.5 h-3.5" />
              Stats
            </button>
            <button 
              onClick={() => setView("admins")}
              className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all ${
                view === "admins" 
                  ? "bg-slate-800 dark:bg-blue-600 text-white shadow-md" 
                  : "text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
              }`}
            >
              <Shield className="w-3.5 h-3.5" />
              Access
            </button>
            <button 
              onClick={() => setView("audit")}
              className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all ${
                view === "audit" 
                  ? "bg-slate-800 dark:bg-blue-600 text-white shadow-md" 
                  : "text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              Audit
            </button>
          </div>

          {/* Stats Card */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 shadow-sm">
            <h2 className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-[0.15em] mb-5">System Overview</h2>
            <div className="space-y-5">
              <div className="flex justify-between items-end">
                <div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Inverted Index</p>
                  <p className="text-2xl font-bold text-slate-800 dark:text-white tabular-nums">
                    {stats?.terms.toLocaleString() || "0"}
                  </p>
                </div>
                <span className="text-[10px] text-slate-400 dark:text-slate-600 font-bold uppercase">Terms</span>
              </div>
              <div className="flex justify-between items-end border-t border-slate-100 dark:border-slate-800 pt-5">
                <div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Documents Indexed</p>
                  <p className="text-2xl font-bold text-slate-800 dark:text-white tabular-nums">
                    {stats?.documents.toLocaleString() || "0"}
                  </p>
                </div>
                <span className="text-[10px] text-slate-400 dark:text-slate-600 font-bold uppercase">Files</span>
              </div>
              <div className="flex justify-between items-end border-t border-slate-100 dark:border-slate-800 pt-5">
                <div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Visual Assets</p>
                  <p className="text-2xl font-bold text-slate-800 dark:text-white tabular-nums">
                    {stats?.images.toLocaleString() || "0"}
                  </p>
                </div>
                <span className="text-[10px] text-slate-400 dark:text-slate-600 font-bold uppercase">Images</span>
              </div>
            </div>
          </div>

          {/* Ranking Model Selection (Mock UI for Polish) */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 shadow-sm">
            <h2 className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-[0.15em] mb-4">Ranking Model</h2>
            <div className="space-y-2">
              <label className="flex items-center space-x-3 p-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-900/40 rounded cursor-pointer group">
                <div className="w-4 h-4 rounded-full border-2 border-blue-600 dark:border-blue-500 flex items-center justify-center">
                  <div className="w-2 h-2 bg-blue-600 dark:bg-blue-500 rounded-full" />
                </div>
                <span className="text-sm font-semibold text-blue-900 dark:text-blue-100">BM25 (Default)</span>
              </label>
              <label className="flex items-center space-x-3 p-2 hover:bg-slate-50 dark:hover:bg-slate-800 border border-transparent rounded cursor-pointer opacity-40 transition-all">
                <div className="w-4 h-4 rounded-full border-2 border-slate-300 dark:border-slate-700" />
                <span className="text-sm font-medium text-slate-600 dark:text-slate-400">TF-IDF</span>
              </label>
            </div>
            <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800">
              <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-relaxed font-medium">
                Current params: <span className="text-slate-600 dark:text-slate-300">k1=1.2, b=0.75</span>. Query normalization active.
              </p>
            </div>
          </div>

            {/* Mock Console Logs for Polish */}
            <div className="flex-1 bg-slate-900 border border-slate-800 rounded-lg p-4 font-mono text-[11px] text-slate-300 overflow-hidden flex flex-col shadow-inner">
              <div className="flex items-center justify-between mb-3 text-slate-500 border-b border-slate-800 pb-2">
                <p className="font-bold tracking-widest text-[9px]">ENGINE_LOGS</p>
                <Activity className="w-3 h-3 text-emerald-500" />
              </div>
              <div className="space-y-2 space-y-reverse flex flex-col-reverse flex-1 overflow-y-auto scrollbar-none">
                {isCrawling && (
                  <p className="animate-pulse"><span className="text-emerald-500">[WRN]</span> Crawl worker active...</p>
                )}
                {isSearching && (
                   <p><span className="text-blue-400">[QRY]</span> Executing ranking pipeline...</p>
                )}
                <p><span className="text-slate-500">[SYS]</span> BM25 scoring matrices ready</p>
                <p><span className="text-slate-500">[SYS]</span> Index persistent in memory</p>
                <p><span className="text-emerald-500">[OK]</span> Engine heart-beat healthy</p>
              </div>
            </div>
          </aside>
        )}

        {/* Right Section - Content Area */}
        <section className={`col-span-1 ${(isAdmin && hasSearched) ? 'md:col-span-9' : 'md:col-span-12'} flex flex-col space-y-6 overflow-hidden transition-all duration-500`}>
          {(!isAdmin && view === "dashboard") ? setView("search") as any : null}
          
          {!hasSearched && view === "search" ? (
            <div className="flex-1 flex flex-col items-center justify-center -mt-20">
              <motion.div
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-col items-center w-full max-w-2xl px-6"
              >
                <div className="mb-8">
                  <GoogleLogo size="text-7xl md:text-8xl" />
                </div>
                
                <form onSubmit={handleSearch} className="w-full relative group">
                  <div className="relative">
                    <div className="absolute inset-y-0 left-5 flex items-center pointer-events-none">
                      <Search className="w-5 h-5 text-slate-400" />
                    </div>
                    <input 
                      type="text"
                      value={query}
                      onChange={handleQueryChange}
                      onFocus={() => setShowSuggestions(true)}
                      className="w-full pl-14 pr-24 py-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-full shadow-sm hover:shadow-md transition-all focus:outline-none focus:ring-1 focus:ring-blue-500/20 focus:border-blue-400 text-lg dark:text-white"
                      placeholder="Search the index or type a query..."
                    />
                    <div className="absolute inset-y-0 right-4 flex items-center gap-3">
                      <button 
                        type="button" 
                        onClick={() => document.getElementById('hero-image-upload')?.click()}
                        className="p-2 text-slate-400 hover:text-blue-500 transition-colors"
                        title="Search by image"
                      >
                        <ImageIcon className="w-5 h-5" />
                      </button>
                      <input id="hero-image-upload" type="file" hidden accept="image/*" onChange={handleImageUpload} />
                    </div>
                  </div>

                  <AnimatePresence>
                    {showSuggestions && suggestions.length > 0 && (
                      <motion.div 
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl z-50 overflow-hidden"
                      >
                        {suggestions.map((s, i) => (
                          <button 
                            key={i}
                            onClick={() => {
                              setQuery(s);
                              handleSearch(undefined, 1, s);
                            }}
                            className="w-full px-6 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-4 text-sm dark:text-slate-200"
                          >
                            <Clock className="w-4 h-4 text-slate-300" />
                            {s}
                          </button>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </form>

                <div className="flex items-center gap-3 mt-8">
                  <button 
                    onClick={handleSearch}
                    className="px-6 py-2 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-sm font-medium text-slate-600 dark:text-slate-300 rounded border border-transparent hover:border-slate-200 dark:hover:border-slate-600 transition-all shadow-sm"
                  >
                    MiniSearch Engine
                  </button>
                  <button 
                    onClick={() => {
                      const lucky = searchHistory[0] || "Architecture";
                      setQuery(lucky);
                      handleSearch(undefined, 1, lucky);
                    }}
                    className="px-6 py-2 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-sm font-medium text-slate-600 dark:text-slate-300 rounded border border-transparent hover:border-slate-200 dark:hover:border-slate-600 transition-all shadow-sm"
                  >
                    I'm Feeling Lucky
                  </button>
                </div>

                <div className="mt-12 flex flex-wrap justify-center gap-x-6 gap-y-2 text-xs text-slate-400 uppercase font-bold tracking-widest">
                  <span className="text-slate-300 dark:text-slate-600">MiniSearch in:</span>
                  <a href="#" className="text-blue-600 hover:underline">English</a>
                  <a href="#" className="text-blue-600 hover:underline">Developer Mode</a>
                  <a href="#" className="text-blue-600 hover:underline">Admin Panel</a>
                </div>
              </motion.div>
            </div>
          ) : view === "search" ? (
            <>
              {/* Crawler Form Overlay/Card */}
              {isAdmin && (
                <AnimatePresence>
                  {showCrawler && (
                    <motion.div 
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="bg-white dark:bg-slate-900 border border-blue-200 dark:border-blue-900/30 rounded-lg p-6 shadow-md mb-2">
                        <header className="flex justify-between items-center mb-4">
                          <h3 className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                            <Globe className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                            Add Documents to Index
                          </h3>
                        </header>
                        <form onSubmit={handleCrawl} className="flex flex-col gap-4">
                          <div className="flex gap-4">
                            <div className="flex-1 space-y-1.5">
                              <label className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest px-1">Entry Point URL</label>
                              <input
                                type="url"
                                value={crawlUrl}
                                onChange={(e) => setCrawlUrl(e.target.value)}
                                placeholder="https://example.com/docs"
                                required
                                className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all dark:text-slate-200"
                              />
                            </div>
                            <div className="w-24 space-y-1.5">
                              <label className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest px-1">Depth</label>
                              <input
                                type="number"
                                min="1"
                                max="3"
                                value={crawlDepth}
                                onChange={(e) => setCrawlDepth(parseInt(e.target.value) || 1)}
                                className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all dark:text-slate-200"
                              />
                            </div>
                          </div>
                          <div className="flex justify-end">
                            <button 
                              type="submit"
                              disabled={isSearching || isCrawling}
                              className="bg-blue-600 text-white px-8 py-2.5 rounded-lg text-sm font-bold hover:bg-blue-700 transition-all shadow-sm hover:shadow-md disabled:opacity-50 flex items-center gap-2 active:scale-95"
                            >
                              {isCrawling ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                              Start Crawl & Index
                            </button>
                          </div>
                        </form>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              )}

              {/* Search Card */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4 shadow-sm space-y-4">
                <div className="flex items-center space-x-2 border-b border-slate-100 dark:border-slate-800 pb-2 mb-2">
                  <button 
                    onClick={() => setSearchType("text")}
                    className={`px-3 py-1 text-[10px] font-bold uppercase tracking-widest rounded transition-all ${searchType === "text" ? "bg-slate-800 dark:bg-blue-600 text-white shadow-sm" : "text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"}`}
                  >
                    Text Search
                  </button>
                  <button 
                    onClick={() => setSearchType("image")}
                    className={`px-3 py-1 text-[10px] font-bold uppercase tracking-widest rounded transition-all ${searchType === "image" ? "bg-slate-800 dark:bg-blue-600 text-white shadow-sm" : "text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"}`}
                  >
                    Image Search
                  </button>
                </div>
                
                <form onSubmit={handleSearch} className="flex flex-col gap-4">
                  <div className="flex items-center space-x-4">
                    <div className="flex-1 relative group">
                      <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
                        {(isSearching || isAnalyzing) ? <Loader2 className="w-5 h-5 text-blue-500 animate-spin" /> : <Search className="w-5 h-5 text-slate-400 group-focus-within:text-blue-500 dark:group-focus-within:text-blue-400 transition-colors" />}
                      </div>
                      <input
                        type="text"
                        value={query}
                        onChange={handleQueryChange}
                        onFocus={() => (query.length >= 2 || searchHistory.length > 0) && setShowSuggestions(true)}
                        placeholder={searchType === "text" ? "Search the document index..." : "Search for images or analyze one..."}
                        className="w-full pl-12 pr-12 py-3.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all placeholder:text-slate-400 dark:placeholder:text-slate-600 dark:text-white"
                      />
                      <div className="absolute inset-y-0 right-3 flex items-center gap-2">
                        <button 
                          type="button" 
                          onClick={() => document.getElementById('results-image-upload')?.click()}
                          className="p-2 text-slate-400 hover:text-blue-500 transition-colors"
                          title="Search by image"
                        >
                          <ImageIcon className="w-5 h-5" />
                        </button>
                        <input id="results-image-upload" type="file" hidden accept="image/*" onChange={handleImageUpload} />
                        <button 
                          type="button"
                          onClick={() => setShowAdvanced(!showAdvanced)}
                          className={`p-2 rounded transition-colors ${showAdvanced ? "bg-blue-100 dark:bg-blue-900/40 text-blue-600" : "text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"}`}
                        >
                          <Settings className={`w-4 h-4 ${showAdvanced ? "animate-spin-slow" : ""}`} />
                        </button>
                      </div>
                      <AnimatePresence>
                        {showSuggestions && (suggestions.length > 0 || (searchHistory.length > 0 && query.length < 2)) && (
                          <motion.div 
                            initial={{ opacity: 0, y: -10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            className="absolute left-0 right-0 top-full mt-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-xl z-50 overflow-hidden transition-colors"
                          >
                            {query.length < 2 && searchHistory.length > 0 && (
                              <div className="bg-slate-50 dark:bg-slate-800 px-4 py-2 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center">
                                <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">Recent Searches</span>
                                <button 
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    clearHistory();
                                  }}
                                  className="text-[10px] text-blue-600 dark:text-blue-400 font-bold hover:underline"
                                >
                                  Clear
                                </button>
                              </div>
                            )}
                            {(query.length < 2 ? searchHistory : suggestions).map((s) => (
                              <button
                                key={s}
                                type="button"
                                onClick={() => {
                                  setQuery(s);
                                  if (query.length >= 2) setSuggestions([]);
                                  setShowSuggestions(false);
                                  handleSearch(undefined, 1, s);
                                }}
                                className="w-full text-left px-4 py-2.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-2 border-b border-slate-50 dark:border-slate-800 last:border-0 group select-none transition-colors dark:text-slate-200"
                              >
                                {query.length < 2 ? (
                                  <Search className="w-3 h-3 text-slate-300 dark:text-slate-600 group-hover:text-blue-400" />
                                ) : (
                                  <Activity className="w-3 h-3 text-blue-400" />
                                )}
                                {s}
                              </button>
                            ))}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                    <button 
                      type="submit"
                      disabled={isSearching}
                      className="px-10 py-3.5 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 hover:shadow-lg transition-all active:scale-95 disabled:opacity-50"
                    >
                      Search
                    </button>
                  </div>

                  {selectedImage && (
                    <div className="flex items-center gap-3 bg-blue-50 dark:bg-blue-900/20 p-2 rounded-lg border border-blue-100 dark:border-blue-900/30">
                      <div className="w-10 h-10 rounded border border-blue-200 dark:border-blue-800 overflow-hidden shrink-0">
                        <img src={selectedImage.base64} alt="Selected" className="w-full h-full object-cover" />
                      </div>
                      <div className="flex-1">
                        <p className="text-[10px] font-bold text-blue-600 dark:text-blue-400 uppercase tracking-widest">Analyzing Image</p>
                        <p className="text-xs text-slate-600 dark:text-slate-400 truncate">{selectedImage.name}</p>
                      </div>
                      <button 
                        onClick={() => setSelectedImage(null)}
                        className="p-1 hover:bg-blue-100 dark:hover:bg-blue-900/40 rounded-full text-blue-400 hover:text-blue-600 dark:hover:text-blue-300"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  )}

                  <div className="flex justify-between items-center px-1">
                    <button 
                      type="button"
                      onClick={() => setShowAdvanced(!showAdvanced)}
                      className="text-[10px] font-bold text-blue-600 uppercase tracking-widest hover:text-blue-700 transition-colors flex items-center gap-1"
                    >
                      {showAdvanced ? "Hide Advanced Options" : "Advanced Search Options"}
                      <ChevronRight className={`w-3 h-3 transition-transform ${showAdvanced ? "rotate-90" : ""}`} />
                    </button>
                    {(mustWords || notWords || phrase) && !showAdvanced && (
                       <span className="text-[10px] text-emerald-600 font-bold uppercase tracking-widest bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100">
                         Active Filters
                       </span>
                    )}
                  </div>

                  <AnimatePresence>
                    {showAdvanced && (
                      <motion.div 
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden border-t border-slate-100 dark:border-slate-800 pt-4"
                      >
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          <div className="space-y-1.5">
                            <label className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">All these words (AND)</label>
                            <input 
                              type="text" 
                              value={mustWords}
                              onChange={(e) => setMustWords(e.target.value)}
                              placeholder="word1 word2..."
                              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 dark:text-white"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">Exact phrase</label>
                            <input 
                              type="text" 
                              value={phrase}
                              onChange={(e) => setPhrase(e.target.value)}
                              placeholder="the specific phrase"
                              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 dark:text-white"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">None of these words (NOT)</label>
                            <input 
                              type="text" 
                              value={notWords}
                              onChange={(e) => setNotWords(e.target.value)}
                              placeholder="exclude these"
                              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 dark:text-white"
                            />
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </form>
              </div>

              {/* Results Area */}
              <div className="flex-1 flex flex-col space-y-4 overflow-y-auto pr-2 custom-scrollbar">
                {(results.length > 0 || imageResults.length > 0) && (
                  <div className="flex items-center justify-between px-2 shrink-0">
                    <p className="text-xs text-slate-500 font-medium tracking-wide">
                      Found <span className="text-slate-800 font-bold">{searchType === "image" ? imageResults.length : totalResults}</span> candidates in {searchTime.toFixed(3)} seconds
                    </p>
                    {searchType === "text" && (
                      <div className="flex items-center space-x-6 text-[9px] font-bold text-slate-400 tracking-[0.1em]">
                        <div className="flex items-center space-x-2">
                          <span className="uppercase">Sort by:</span>
                          <select 
                            value={sortBy}
                            onChange={(e) => setSortBy(e.target.value as any)}
                            className="bg-transparent border-none focus:ring-0 text-slate-600 cursor-pointer hover:text-blue-600 transition-colors uppercase outline-none"
                          >
                            <option value="relevance">Relevance</option>
                            <option value="date">Date</option>
                            <option value="url">URL</option>
                          </select>
                        </div>
                        <button 
                          onClick={() => setSortOrder(sortOrder === "asc" ? "desc" : "asc")}
                          className="flex items-center space-x-1 hover:text-blue-600 transition-colors uppercase"
                        >
                          <span>Order: {sortOrder}</span>
                        </button>
                        <span>PAGE {currentPage} OF {totalPages || 1}</span>
                      </div>
                    )}
                  </div>
                )}

                <div className="space-y-4 pb-12">
                  <AnimatePresence initial={false}>
                    {searchType === "text" ? results.map((result, idx) => (
                      <motion.div 
                        key={`${result.url}-${idx}-${query}`}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: idx * 0.03 }}
                        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6 hover:border-blue-300 dark:hover:border-blue-800 hover:shadow-md transition-all cursor-pointer group"
                        onClick={() => window.open(result.url, '_blank')}
                      >
                        <div className="flex justify-between items-start mb-2">
                          <div className="flex-1 pr-4">
                            <h3 className="text-lg font-bold text-blue-700 dark:text-blue-400 group-hover:text-blue-800 dark:group-hover:text-blue-300 group-hover:underline transition-colors leading-tight">
                              {result.title}
                            </h3>
                            <p className="text-[11px] text-emerald-600 dark:text-emerald-500 font-semibold truncate mt-1">
                              {result.url}
                            </p>
                          </div>
                          <div className="flex flex-col items-end gap-1">
                            <div className="bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 text-[10px] font-bold px-3 py-1.5 rounded-full border border-blue-100 dark:border-blue-900/40 uppercase tracking-wider shrink-0 shadow-sm">
                              BM25: {result.score.toFixed(2)}
                            </div>
                            <span className="text-[9px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-tight">
                              {new Date(result.indexedAt).toLocaleDateString()}
                            </span>
                          </div>
                        </div>
                        <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed line-clamp-2">
                          {highlightText(result.snippet, getCombinedQueryTokens())}
                        </p>
                      </motion.div>
                    )) : (
                      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                        {imageResults.map((img, idx) => (
                          <motion.div
                            key={`${img.url}-${idx}`}
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            whileHover={{ y: -5, transition: { duration: 0.2 } }}
                            transition={{ delay: idx * 0.05 }}
                            className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm hover:shadow-xl transition-all cursor-pointer group flex flex-col relative"
                          >
                            <div className="aspect-square bg-slate-100 dark:bg-slate-800 overflow-hidden relative" onClick={() => setViewImage(img)}>
                              <img 
                                src={img.url} 
                                alt={img.alt} 
                                className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700"
                                referrerPolicy="no-referrer"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).src = `https://placehold.co/400x400/f1f5f9/94a3b8?text=${encodeURIComponent(img.alt || 'No Image')}`;
                                }}
                              />
                              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                                <Activity className="w-8 h-8 text-white animate-pulse" />
                              </div>
                            </div>
                            <div className="p-3 space-y-1 group-hover:bg-blue-50/50 dark:group-hover:bg-blue-900/20 transition-colors flex-1 flex flex-col justify-between">
                              <div onClick={() => setViewImage(img)}>
                                <p className="text-xs font-bold text-slate-800 dark:text-slate-200 line-clamp-2 leading-tight mb-1">{img.alt || "Visual Result"}</p>
                                <p className="text-[9px] text-slate-500 dark:text-slate-500 line-clamp-1 flex items-center gap-1 uppercase tracking-tight">
                                  <Globe className="w-2.5 h-2.5" />
                                  {new URL(img.parentUrl).hostname}
                                </p>
                              </div>
                              <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-col gap-2">
                                <div className="flex justify-between items-center text-[9px] font-bold uppercase text-slate-400">
                                  <span>Similarity</span>
                                  <span className="text-blue-600 dark:text-blue-400">{(img.score * 10).toFixed(0)}%</span>
                                </div>
                                <button 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleMoreLikeThis(img);
                                  }}
                                  disabled={isAnalyzing}
                                  className="w-full py-1.5 border border-blue-200 dark:border-blue-800 rounded text-[9px] font-bold uppercase text-blue-600 dark:text-blue-400 hover:bg-blue-600 dark:hover:bg-blue-600 hover:text-white dark:hover:text-white transition-all flex items-center justify-center gap-1.5 disabled:opacity-50"
                                >
                                  {isAnalyzing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Activity className="w-3 h-3" />}
                                  {isAnalyzing ? "Analyzing..." : "More like this"}
                                </button>
                              </div>
                            </div>
                          </motion.div>
                        ))}
                      </div>
                    )}
                  </AnimatePresence>

                  {results.length === 0 && imageResults.length === 0 && !isSearching && !isAnalyzing && query && (
                    <div className="flex flex-col items-center justify-center py-32 text-center">
                      <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4">
                        <Search className="w-8 h-8 text-slate-300" />
                      </div>
                      <h3 className="text-lg font-bold text-slate-800">No matches found</h3>
                      <p className="text-slate-500 max-w-xs mt-2 text-sm leading-relaxed">
                        Try adjusting your keywords or add more URLs to the index using the crawler.
                      </p>
                    </div>
                  )}

                    {results.length === 0 && !isSearching && !query && (
                      <div className="flex flex-col items-center justify-center py-32 text-center">
                        <div className="opacity-30 flex flex-col items-center">
                          <Database className="w-20 h-20 mb-6" />
                          <p className="text-lg font-medium italic">System ready. Enter a query or index a site to begin.</p>
                        </div>
                        
                        {isAdmin && (
                          <motion.div 
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="mt-12 p-6 bg-blue-50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-900/30 rounded-2xl max-w-md"
                          >
                            <h4 className="text-sm font-bold text-blue-900 dark:text-blue-100 mb-2 flex items-center justify-center gap-2">
                              <Shield className="w-4 h-4" />
                              Administrator Quick Start
                            </h4>
                            <p className="text-xs text-blue-700 dark:text-blue-300 mb-6 leading-relaxed">
                              You are currently in search mode. As an admin, you should start by indexing pages or checking system health.
                            </p>
                            <div className="flex gap-3 justify-center">
                              <button 
                                onClick={() => setShowCrawler(true)}
                                className="px-4 py-2 bg-blue-600 text-white text-xs font-bold uppercase rounded-lg hover:bg-blue-700 transition-all shadow-md active:scale-95"
                              >
                                Open Crawler
                              </button>
                              <button 
                                onClick={() => setView("dashboard")}
                                className="px-4 py-2 bg-white dark:bg-slate-900 border border-blue-200 dark:border-blue-800 text-blue-600 dark:text-blue-400 text-xs font-bold uppercase rounded-lg hover:bg-blue-50 dark:hover:bg-slate-800 transition-all active:scale-95"
                              >
                                Stats Dashboard
                              </button>
                            </div>
                          </motion.div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Pagination Controls */}
                {totalPages > 1 && (
                  <div className="flex justify-center items-center space-x-2 py-6 shrink-0 border-t border-slate-100">
                    <button
                      onClick={() => handleSearch(undefined, currentPage - 1)}
                      disabled={currentPage === 1 || isSearching}
                      className="px-3 py-1.5 text-xs font-bold uppercase tracking-widest text-slate-500 hover:text-blue-600 disabled:opacity-30 transition-colors"
                    >
                      Previous
                    </button>
                    <div className="flex space-x-1">
                      {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                        let pageNum = i + 1;
                        if (totalPages > 5 && currentPage > 3) {
                          pageNum = currentPage - 3 + i + 1;
                          if (pageNum > totalPages) pageNum = totalPages - (4 - i);
                        }
                        return (
                          <button
                            key={pageNum}
                            onClick={() => handleSearch(undefined, pageNum)}
                            className={`w-8 h-8 rounded text-xs font-bold transition-all ${
                              currentPage === pageNum
                                ? "bg-blue-600 text-white shadow-md scale-110"
                                : "bg-white border border-slate-200 text-slate-600 hover:border-blue-300"
                            }`}
                          >
                            {pageNum}
                          </button>
                        );
                      })}
                    </div>
                    <button
                      onClick={() => handleSearch(undefined, currentPage + 1)}
                      disabled={currentPage === totalPages || isSearching}
                      className="px-3 py-1.5 text-xs font-bold uppercase tracking-widest text-slate-500 hover:text-blue-600 disabled:opacity-30 transition-colors"
                    >
                      Next
                    </button>
                  </div>
                )}
            </>
          ) : view === "dashboard" ? (
            <motion.div 
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex-1 overflow-y-auto space-y-6 pr-2 custom-scrollbar"
            >
              <div className="grid grid-cols-2 gap-6">
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6 shadow-sm">
                  <h3 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-6">Inverted Index Density (Top 10 Terms)</h3>
                  <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={stats?.topTerms || []}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={darkMode ? "#1e293b" : "#f1f5f9"} />
                        <XAxis dataKey="term" fontSize={10} axisLine={false} tickLine={false} tick={{fill: darkMode ? '#64748b' : '#94a3b8'}} />
                        <YAxis hide />
                        <Tooltip 
                          contentStyle={{backgroundColor: darkMode ? '#0f172a' : '#ffffff', borderRadius: '8px', border: `1px solid ${darkMode ? '#1e293b' : '#e2e8f0'}`, boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}}
                          itemStyle={{fontSize: '12px', fontWeight: 'bold', color: darkMode ? '#f1f5f9' : '#0f172a'}}
                        />
                        <Bar 
                          dataKey="count" 
                          fill={darkMode ? "#3b82f6" : "#2563eb"} 
                          radius={[4, 4, 0, 0]} 
                          barSize={30} 
                          className="cursor-pointer hover:opacity-80 transition-opacity"
                          onClick={(data) => {
                            if (data && data.term) {
                              const newMust = mustWords.includes(data.term) ? mustWords : (mustWords ? `${mustWords} ${data.term}` : data.term);
                              setMustWords(newMust);
                              setView("search");
                              handleSearch(undefined, 1, undefined, newMust);
                            }
                          }}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6 shadow-sm">
                  <h3 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-6">Domain Distribution</h3>
                  <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={stats?.domainDist || []}
                          innerRadius={60}
                          outerRadius={80}
                          paddingAngle={5}
                          dataKey="value"
                        >
                          {(stats?.domainDist || []).map((_, index) => (
                            <Cell key={`cell-${index}`} fill={darkMode ? ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'][index % 5] : ['#2563eb', '#059669', '#d97706', '#dc2626', '#7c3aed'][index % 5]} />
                          ))}
                        </Pie>
                        <Tooltip contentStyle={{backgroundColor: darkMode ? '#0f172a' : '#ffffff', border: `1px solid ${darkMode ? '#1e293b' : '#e2e8f0'}`}} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6 shadow-sm">
                <h3 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-4">Index Health Metrics</h3>
                <div className="grid grid-cols-3 gap-4">
                  {[
                    { label: "Vocabulary Size", value: stats?.terms, unit: "unique stems" },
                    { label: "Document Volume", value: stats?.documents, unit: "indexed files" },
                    { label: "Avg Doc Length", value: "248.4", unit: "tokens" }
                  ].map((item, i) => (
                    <div key={i} className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-100 dark:border-slate-800">
                      <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase mb-1">{item.label}</p>
                      <p className="text-xl font-bold text-slate-800 dark:text-white">{item.value?.toLocaleString()}</p>
                      <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1">{item.unit}</p>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          ) : view === "admins" ? (
            <motion.div 
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              className="flex-1 overflow-y-auto space-y-6 pr-2 custom-scrollbar"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-bold text-slate-900 dark:text-white">Access Control</h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Manage administrator privileges and system users.</p>
                </div>
                <button 
                  onClick={fetchAdminData}
                  disabled={isLoadingAdmins}
                  className="p-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                >
                  <Activity className={`w-4 h-4 text-blue-600 ${isLoadingAdmins ? 'animate-spin' : ''}`} />
                </button>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Administrators List */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-sm flex flex-col overflow-hidden">
                  <div className="p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 flex items-center justify-between">
                    <h3 className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest flex items-center gap-2">
                      <Shield className="w-3 h-3" />
                      Active Administrators
                    </h3>
                    <span className="bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 text-[10px] font-bold px-2 py-0.5 rounded-full">
                      {allAdmins.length}
                    </span>
                  </div>
                  <div className="flex-1 overflow-y-auto max-h-[500px]">
                    {allAdmins.length === 0 && !isLoadingAdmins ? (
                      <div className="p-12 text-center text-slate-400 italic text-sm">No administrators found.</div>
                    ) : (
                      <div className="divide-y divide-slate-50 dark:divide-slate-800">
                        {allAdmins.map((admin) => (
                          <div key={admin.uid} className="p-4 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center text-blue-600 dark:text-blue-400 text-xs font-bold">
                                {admin.displayName?.[0] || 'A'}
                              </div>
                              <div>
                                <p className="text-sm font-bold text-slate-800 dark:text-slate-200">{admin.displayName || 'System Admin'}</p>
                                <p className="text-[10px] text-slate-500 dark:text-slate-500 font-medium">{admin.email}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-4">
                              <div className="text-right hidden sm:block">
                                <p className="text-[9px] text-slate-400 uppercase font-bold tracking-tight">Added On</p>
                                <p className="text-[10px] text-slate-600 dark:text-slate-400 font-semibold tabular-nums">
                                  {admin.addedAt?.toDate ? admin.addedAt.toDate().toLocaleDateString() : 'Initial'}
                                </p>
                              </div>
                              {admin.email !== "puskardasofficial@gmail.com" && (
                                <button 
                                  onClick={() => toggleAdmin({ uid: admin.uid, email: admin.email, displayName: admin.displayName } as any)}
                                  className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-lg transition-all"
                                  title="Revoke Admin Access"
                                >
                                  <UserMinus className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* System Users List */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-sm flex flex-col overflow-hidden">
                  <div className="p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 flex items-center justify-between">
                    <h3 className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest flex items-center gap-2">
                      <Users className="w-3 h-3" />
                      Recent System Users
                    </h3>
                    <span className="bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 text-[10px] font-bold px-2 py-0.5 rounded-full">
                      {allUsers.length}
                    </span>
                  </div>
                  <div className="flex-1 overflow-y-auto max-h-[500px]">
                    {allUsers.length === 0 && !isLoadingAdmins ? (
                      <div className="p-12 text-center text-slate-400 italic text-sm">No users registered yet.</div>
                    ) : (
                      <div className="divide-y divide-slate-50 dark:divide-slate-800">
                        {allUsers.map((u) => {
                          const isAd = allAdmins.some(a => a.uid === u.uid);
                          return (
                            <div key={u.uid} className="p-4 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                              <div className="flex items-center gap-3">
                                {u.photoURL ? (
                                  <img src={u.photoURL} alt="" className="w-8 h-8 rounded-full border border-slate-200 dark:border-slate-800" />
                                ) : (
                                  <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400 text-xs font-bold">
                                    {u.displayName?.[0] || 'U'}
                                  </div>
                                )}
                                <div>
                                  <div className="flex items-center gap-2">
                                    <p className="text-sm font-bold text-slate-800 dark:text-slate-200">{u.displayName || 'Guest'}</p>
                                    {isAd && <Shield className="w-3 h-3 text-blue-500" />}
                                  </div>
                                  <p className="text-[10px] text-slate-500 dark:text-slate-500 font-medium">{u.email}</p>
                                </div>
                              </div>
                              <div className="flex items-center gap-4">
                                <div className="text-right hidden sm:block">
                                  <p className="text-[9px] text-slate-400 uppercase font-bold tracking-tight">Last Seen</p>
                                  <p className="text-[10px] text-slate-600 dark:text-slate-400 font-semibold tabular-nums">
                                    {u.lastLogin?.toDate ? u.lastLogin.toDate().toLocaleDateString() : 'N/A'}
                                  </p>
                                </div>
                                <button 
                                  onClick={() => toggleAdmin(u)}
                                  disabled={u.email === "puskardasofficial@gmail.com"}
                                  className={`p-2 rounded-lg transition-all ${
                                    isAd 
                                      ? "text-blue-600 bg-blue-50 dark:bg-blue-900/20 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30" 
                                      : "text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                                  }`}
                                  title={isAd ? "Revoke Admin" : "Grant Admin"}
                                >
                                  {isAd ? <CheckCircle className="w-4 h-4" /> : <UserPlus className="w-4 h-4" />}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          ) : view === "audit" ? (
            <motion.div 
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex-1 overflow-y-auto space-y-6 pr-2 custom-scrollbar"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-bold text-slate-900 dark:text-white">System Audit Log</h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Traceable record of all administrative actions performed on the system.</p>
                </div>
                <div className="flex items-center gap-3">
                  <button 
                    onClick={fetchAdminData}
                    disabled={isLoadingLogs}
                    className="p-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                  >
                    <Activity className={`w-4 h-4 text-blue-600 ${isLoadingLogs ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              </div>

              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-sm overflow-hidden">
                <div className="p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 flex items-center justify-between">
                  <h3 className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest flex items-center gap-2">
                    <Clock className="w-3 h-3" />
                    Recent Actions (Last 50)
                  </h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead className="bg-slate-50 dark:bg-slate-800/50">
                      <tr>
                        <th className="px-6 py-3 text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Timestamp</th>
                        <th className="px-6 py-3 text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Administrator</th>
                        <th className="px-6 py-3 text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Action Type</th>
                        <th className="px-6 py-3 text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Details</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {allLogs.length === 0 && !isLoadingLogs ? (
                        <tr>
                          <td colSpan={4} className="px-6 py-12 text-center text-slate-400 italic text-sm">No logs found.</td>
                        </tr>
                      ) : (
                        allLogs.map((log) => (
                          <tr key={log.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors">
                            <td className="px-6 py-4 text-[10px] font-medium text-slate-500 dark:text-slate-400 tabular-nums">
                              {log.timestamp?.toDate ? log.timestamp.toDate().toLocaleString() : 'Recent'}
                            </td>
                            <td className="px-6 py-4">
                              <p className="text-[11px] font-bold text-slate-800 dark:text-slate-200">{log.adminEmail}</p>
                              <p className="text-[9px] text-slate-400 font-medium">UID: {log.adminId.slice(0, 8)}...</p>
                            </td>
                            <td className="px-6 py-4">
                              <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-tighter ${
                                log.action.includes('GRANT') ? "bg-emerald-100 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400" :
                                log.action.includes('REVOKE') ? "bg-red-100 text-red-600 dark:bg-red-950/40 dark:text-red-400" :
                                log.action.includes('CRAWL') ? "bg-blue-100 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400" :
                                "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                              }`}>
                                {log.action}
                              </span>
                            </td>
                            <td className="px-6 py-4">
                              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed max-w-md truncate" title={log.details}>
                                {log.details}
                              </p>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </motion.div>
          ) : null}
        </section>
      </main>

      {/* Image Full View Modal */}
      <AnimatePresence>
        {viewImage && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-8 bg-slate-900/90 backdrop-blur-sm"
            onClick={() => setViewImage(null)}
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl max-w-5xl w-full max-h-[90vh] overflow-hidden flex flex-col md:flex-row border border-slate-200 dark:border-slate-800"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex-1 bg-slate-100 dark:bg-slate-950 flex items-center justify-center min-h-[300px] overflow-hidden relative">
                <img 
                  src={viewImage.url} 
                  alt={viewImage.alt} 
                  className="max-w-full max-h-full object-contain"
                  referrerPolicy="no-referrer"
                />
                <button 
                  onClick={() => setViewImage(null)}
                  className="absolute top-4 right-4 p-2 bg-white/50 dark:bg-slate-800/50 hover:bg-white dark:hover:bg-slate-700 rounded-full transition-colors shadow-sm"
                >
                  <X className="w-5 h-5 text-slate-800 dark:text-slate-200" />
                </button>
              </div>
              <div className="w-full md:w-80 bg-white dark:bg-slate-900 p-6 flex flex-col">
                <div className="flex-1">
                  <header className="mb-6">
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white leading-tight mb-2">{viewImage.alt || "Visual Result"}</h3>
                    <div className="flex items-center gap-2 text-xs text-blue-600 dark:text-blue-400 font-semibold mb-4">
                      <Globe className="w-3.5 h-3.5" />
                      <a href={viewImage.parentUrl} target="_blank" rel="noreferrer" className="hover:underline line-clamp-1">
                        {new URL(viewImage.parentUrl).hostname}
                      </a>
                    </div>
                  </header>

                  <div className="space-y-4 mb-8">
                    <div>
                      <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1.5 flex justify-between items-center">
                        Accessibility Alt Text
                        {isUpdatingAlt && <Loader2 className="w-3 h-3 animate-spin text-blue-500" />}
                      </p>
                      <div className="flex gap-2">
                        <input 
                          value={editingAlt}
                          onChange={(e) => setEditingAlt(e.target.value)}
                          className="flex-1 text-[11px] px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 dark:text-white transition-all"
                          placeholder="Describe this image..."
                        />
                        <button 
                          onClick={handleUpdateAlt}
                          disabled={isUpdatingAlt || editingAlt === viewImage.alt}
                          className="px-3 py-2 bg-blue-600 text-white text-[10px] font-bold uppercase rounded hover:bg-blue-700 disabled:opacity-50 transition-all active:scale-95 shadow-sm"
                        >
                          Update
                        </button>
                      </div>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1.5">Context Snippet</p>
                      <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed italic border-l-2 border-slate-200 dark:border-slate-700 pl-3">
                        "{viewImage.context || "No context available."}"
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1.5">Similarity Score</p>
                      <div className="w-full bg-slate-100 dark:bg-slate-800 h-2 rounded-full overflow-hidden">
                        <motion.div 
                          initial={{ width: 0 }}
                          animate={{ width: `${Math.min(100, viewImage.score * 10)}%` }}
                          className="h-full bg-blue-600"
                        />
                      </div>
                      <p className="text-[10px] text-right mt-1 font-bold text-blue-600 dark:text-blue-400">{(viewImage.score * 10).toFixed(1)}% Matching</p>
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <button 
                    onClick={() => handleMoreLikeThis(viewImage)}
                    disabled={isAnalyzing}
                    className="w-full py-3 bg-blue-600 text-white rounded-lg font-bold text-sm flex items-center justify-center gap-2 hover:bg-blue-700 transition-all shadow-md active:scale-95 disabled:opacity-50"
                  >
                    {isAnalyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Activity className="w-4 h-4" />}
                    {isAnalyzing ? "Analyzing Features..." : "More Like This"}
                  </button>
                  <button 
                    onClick={() => window.open(viewImage.url, '_blank')}
                    className="w-full py-3 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-lg font-semibold text-sm flex items-center justify-center gap-2 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all"
                  >
                    <Layout className="w-4 h-4" />
                    Open Original Image
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Footer Status Bar */}
      <footer className="bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 px-8 py-2.5 flex items-center justify-between text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest shrink-0 transition-colors">
        <div className="flex items-center gap-6">
          <div>Memory Depth: <span className="text-slate-600 dark:text-slate-300">Local Heap</span></div>
          <div>Mode: <span className="text-slate-600 dark:text-slate-300">High-Performance BM25</span></div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></span>
            Node-01
          </div>
          <div className="text-slate-500 dark:text-slate-600">ApexIndex Engine • v1.2</div>
        </div>
      </footer>
    </div>
  );
}

