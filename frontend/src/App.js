import "./App.css";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { AuthProvider } from "./context/AuthContext";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { Layout } from "./components/Layout";
import { Loader } from "./components/Loader";
import { pageTransition } from "./lib/animations";
import Home from "./pages/Home";
import About from "./pages/About";
import Services from "./pages/Services";
import Process from "./pages/Process";
import CaseStudies from "./pages/CaseStudies";
import Blog from "./pages/Blog";
import BlogPost from "./pages/BlogPost";
import Areas from "./pages/Areas";
import CityPage from "./pages/CityPage";
import Contact from "./pages/Contact";
import AdminLogin from "./pages/AdminLogin";
import AdminDashboard from "./pages/AdminDashboard";

const Page = ({ children }) => (
  <motion.div variants={pageTransition} initial="initial" animate="animate" exit="exit">
    {children}
  </motion.div>
);

function MarketingRoutes() {
  const location = useLocation();
  return (
    <AnimatePresence mode="wait">
      <Routes location={location} key={location.pathname}>
        <Route path="/" element={<Page><Home /></Page>} />
        <Route path="/about" element={<Page><About /></Page>} />
        <Route path="/services" element={<Page><Services /></Page>} />
        <Route path="/process" element={<Page><Process /></Page>} />
        <Route path="/case-studies" element={<Page><CaseStudies /></Page>} />
        <Route path="/blog" element={<Page><Blog /></Page>} />
        <Route path="/blog/:slug" element={<Page><BlogPost /></Page>} />
        <Route path="/areas" element={<Page><Areas /></Page>} />
        <Route path="/areas/:slug" element={<Page><CityPage /></Page>} />
        <Route path="/contact" element={<Page><Contact /></Page>} />
      </Routes>
    </AnimatePresence>
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

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/admin/login" element={<AdminLogin />} />
          <Route path="/admin" element={<ProtectedRoute><AdminDashboard /></ProtectedRoute>} />
          <Route path="/*" element={<MarketingApp />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
