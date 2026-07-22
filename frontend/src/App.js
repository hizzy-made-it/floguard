import "./App.css";
import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { Layout } from "./components/Layout";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Analytics } from "./components/Analytics";
// Home stays eager — primary LCP route (hero video + poster)
import Home from "./pages/Home";

const About = lazy(() => import("./pages/About"));
const Services = lazy(() => import("./pages/Services"));
const ServiceDetail = lazy(() => import("./pages/ServiceDetail"));
const Process = lazy(() => import("./pages/Process"));
const CaseStudies = lazy(() => import("./pages/CaseStudies"));
const Blog = lazy(() => import("./pages/Blog"));
const BlogPost = lazy(() => import("./pages/BlogPost"));
const Areas = lazy(() => import("./pages/Areas"));
const CityPage = lazy(() => import("./pages/CityPage"));
const Contact = lazy(() => import("./pages/Contact"));
const Studio = lazy(() => import("./pages/Studio"));
const AdminLogin = lazy(() => import("./pages/AdminLogin"));
const AdminDashboard = lazy(() => import("./pages/AdminDashboard"));

const RouteFallback = () => (
  <div className="min-h-[40vh] grid place-items-center text-brand-slate text-sm" aria-busy="true" role="status">
    Loading…
  </div>
);

function MarketingRoutes() {
  return (
    <ErrorBoundary>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/about" element={<About />} />
          <Route path="/services" element={<Services />} />
          <Route path="/services/:slug" element={<ServiceDetail />} />
          <Route path="/process" element={<Process />} />
          <Route path="/case-studies" element={<CaseStudies />} />
          <Route path="/blog" element={<Blog />} />
          <Route path="/blog/:slug" element={<BlogPost />} />
          <Route path="/areas" element={<Areas />} />
          <Route path="/areas/:slug" element={<CityPage />} />
          <Route path="/contact" element={<Contact />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}

function MarketingApp() {
  // No intro loader — it delayed LCP and added main-thread work on every first visit
  return (
    <Layout>
      <MarketingRoutes />
    </Layout>
  );
}

/** Hard redirect to the Sales Rev CRM (Vercel). Keeps marketing SPA from swallowing /crm. */
function CrmRedirect() {
  if (typeof window !== "undefined") {
    const path = window.location.pathname.replace(/^\/crm\/?/, "") || "";
    const qs = window.location.search || "";
    const hash = window.location.hash || "";
    const target = `https://floguard-crm.vercel.app/crm/${path}${qs}${hash}`;
    window.location.replace(target);
  }
  return (
    <div className="min-h-[40vh] grid place-items-center text-brand-slate text-sm" role="status">
      Opening FloGuard Sales Rev…
    </div>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <Analytics />
      <AuthProvider>
        <BrowserRouter>
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/admin/login" element={<AdminLogin />} />
              <Route path="/admin" element={<ProtectedRoute><AdminDashboard /></ProtectedRoute>} />
              <Route path="/studio" element={<Studio />} />
              <Route path="/crm/*" element={<CrmRedirect />} />
              <Route path="/crm" element={<CrmRedirect />} />
              <Route path="/*" element={<MarketingApp />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </AuthProvider>
    </ErrorBoundary>
  );
}

export default App;
