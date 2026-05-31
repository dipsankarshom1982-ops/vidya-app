import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import "./index.css";
import Layout from "./components/Layout";

import Dashboard        from "./pages/Dashboard";
import AdsList          from "./pages/AdsList";
import CreateAd         from "./pages/CreateAd";
import Analytics        from "./pages/Analytics";
import Admins           from "./pages/Admins";
import Login            from "./pages/Login";

import PlatformAnalytics from "./pages/PlatformAnalytics";

import Banners              from "./pages/Banners";
import ShortReels           from "./pages/ShortReels";           // 🆕
import SeekhoVideos         from "./pages/SeekhoVideos";
import CreateSeekhoVideo    from "./pages/CreateSeekhoVideo";
import KnowledgeVideos      from "./pages/KnowledgeVideos";
import CreateKnowledgeVideo from "./pages/CreateKnowledgeVideo";
import Stories              from "./pages/Stories";
import Partners             from "./pages/Partners";

import Courses      from "./pages/Courses";
import CreateCourse from "./pages/CreateCourse";
import Lessons      from "./pages/Lessons";
import Practice     from "./pages/Practice";

import Contests        from "./pages/Contests";
import CreateContest   from "./pages/CreateContest";
import VidyastarConfig from "./pages/VidyastarConfig";
import Quizzes         from "./pages/Quizzes";
import CreateQuiz      from "./pages/CreateQuiz";
import QuizQuestions   from "./pages/QuizQuestions";
import SkillBattles    from "./pages/SkillBattles";
import LearnFun        from "./pages/LearnFun";
import BadgesAndStars  from "./pages/BadgesAndStars";

import AppModules        from "./pages/AppModules";
import SubscriptionPlans from "./pages/SubscriptionPlans";
import Coupons           from "./pages/Coupons";
import VCoinRules        from "./pages/VCoinRules";

import Students      from "./pages/Students";
import Subscriptions from "./pages/Subscriptions";
import AiUsage       from "./pages/AiUsage";

import { AuthProvider, useAuth } from "./context/AuthContext";

function ProtectedRoutes() {
  const { user, loading } = useAuth();
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 text-white">
      Loading...
    </div>
  );
  if (!user) return <Navigate to="/login" replace />;

  return (
    <Layout>
      <Routes>
        {/* Overview */}
        <Route path="/"                   element={<Dashboard />} />
        <Route path="/platform-analytics" element={<PlatformAnalytics />} />

        {/* Ads */}
        <Route path="/ads"        element={<AdsList />} />
        <Route path="/ads/new"    element={<CreateAd />} />
        <Route path="/ads/:id"    element={<CreateAd />} />
        <Route path="/analytics"  element={<Analytics />} />

        {/* Content */}
        <Route path="/banners"                    element={<Banners />} />
        <Route path="/short-reels"                element={<ShortReels />} />          {/* 🆕 */}
        <Route path="/seekho-videos"              element={<SeekhoVideos />} />
        <Route path="/seekho-videos/new"          element={<CreateSeekhoVideo />} />
        <Route path="/seekho-videos/:id"          element={<CreateSeekhoVideo />} />
        <Route path="/knowledge-videos"           element={<KnowledgeVideos />} />
        <Route path="/knowledge-videos/new"       element={<CreateKnowledgeVideo />} />
        <Route path="/knowledge-videos/:id"       element={<CreateKnowledgeVideo />} />
        <Route path="/stories"                    element={<Stories />} />
        <Route path="/partners"                   element={<Partners />} />

        {/* Curriculum */}
        <Route path="/courses"                   element={<Courses />} />
        <Route path="/courses/new"               element={<CreateCourse />} />
        <Route path="/courses/:id"               element={<CreateCourse />} />
        <Route path="/courses/:courseId/lessons" element={<Lessons />} />
        <Route path="/practice"                  element={<Practice />} />

        {/* Gamification */}
        <Route path="/contests"                  element={<Contests />} />
        <Route path="/contests/new"              element={<CreateContest />} />
        <Route path="/contests/:id"              element={<CreateContest />} />
        <Route path="/vidyastar-config"          element={<VidyastarConfig />} />
        <Route path="/quizzes"                   element={<Quizzes />} />
        <Route path="/quizzes/new"               element={<CreateQuiz />} />
        <Route path="/quizzes/:id"               element={<CreateQuiz />} />
        <Route path="/quizzes/:quizId/questions" element={<QuizQuestions />} />
        <Route path="/skill-battles"             element={<SkillBattles />} />
        <Route path="/learnfun"                  element={<LearnFun />} />
        <Route path="/badges"                    element={<BadgesAndStars />} />

        {/* App Config */}
        <Route path="/modules"            element={<AppModules />} />
        <Route path="/subscription-plans" element={<SubscriptionPlans />} />
        <Route path="/coupons"            element={<Coupons />} />
        <Route path="/vcoin-rules"        element={<VCoinRules />} />

        {/* Users */}
        <Route path="/students"      element={<Students />} />
        <Route path="/subscriptions" element={<Subscriptions />} />
        <Route path="/ai-usage"      element={<AiUsage />} />

        {/* Admin */}
        <Route path="/admins" element={<Admins />} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/*"     element={<ProtectedRoutes />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  </React.StrictMode>
);
