import "./App.css";
import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { AuthProvider } from "./context/AuthContext";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { Layout } from "./components/Layout";
import { Loader } from "./components/Loader";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Analytics } from "./components/Analytics";
import { pageTransition } from "./lib/animations";
// Home stays eager — primary LCP route
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

const Page = ({ children }) => (
  <motion.div variants={pageTransition} initial="initial" animate="animate" exit="exit">
    {children}
  </motion.div>
);

const RouteFallback = () => (
  <div className="min-h-[40vh] grid place-items-center text-brand-slate text-sm" aria-busy="true" role="status">
    Loading…
  </div>
);

function MarketingRoutes() {
  const location = useLocation();
  return (
    <ErrorBoundary>
      <Suspense fallback={<RouteFallback />}>
        <AnimatePresence mode="wait">
          <Routes location={location} key={location.pathname}>
            <Route path="/" element={<Page><Home /></Page>} />
            <Route path="/about" element={<Page><About /></Page>} />
            <Route path="/services" element={<Page><Services /></Page>} />
            <Route path="/services/:slug" element={<Page><ServiceDetail /></Page>} />
            <Route path="/process" element={<Page><Process /></Page>} />
            <Route path="/case-studies" element={<Page><CaseStudies /></Page>} />
            <Route path="/blog" element={<Page><Blog /></Page>} />
            <Route path="/blog/:slug" element={<Page><BlogPost /></Page>} />
            <Route path="/areas" element={<Page><Areas /></Page>} />
            <Route path="/areas/:slug" element={<Page><CityPage /></Page>} />
            <Route path="/contact" element={<Page><Contact /></Page>} />
          </Routes>
        </AnimatePresence>
      </Suspense>
    </ErrorBoundary>
  );
}

function MarketingApp() {
  return (
    <>
      <Loader />
      <Layout>
        <MarketingRoutes />
      </Layout>
    </>
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
