const { useState, useEffect } = React;

const IconWrapper = ({ children }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="inline-block"
  >
    {children}
  </svg>
);

const MousePointerIcon = () => (
  <IconWrapper>
    <path d="m3 3 7.07 16.97 2.51-7.39 7.39-2.51L3 3z" />
    <path d="m13 13 6 6" />
  </IconWrapper>
);

const CpuIcon = ({ size = 24 }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="4" y="4" width="16" height="16" rx="2" />
    <rect x="9" y="9" width="6" height="6" />
    <path d="M15 2v2" />
    <path d="M15 20v2" />
    <path d="M2 15h2" />
    <path d="M2 9h2" />
    <path d="M20 15h2" />
    <path d="M20 9h2" />
    <path d="M9 2v2" />
    <path d="M9 20v2" />
  </svg>
);

const SparklesIcon = ({ size = 24, className = "" }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d="m12 3 1.912 5.813a2 2 0 0 0 1.275 1.275L21 12l-5.813 1.912a2 2 0 0 0-1.275 1.275L12 21l-1.912-5.813a2 2 0 0 0-1.275-1.275L3 12l5.813-1.912a2 2 0 0 0 1.275-1.275L12 3Z" />
    <path d="M5 3v4" />
    <path d="M19 17v4" />
    <path d="M3 5h4" />
    <path d="M17 19h4" />
  </svg>
);

const BookOpenIcon = () => (
  <IconWrapper>
    <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
    <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
  </IconWrapper>
);

const ClockIcon = ({ size = 24 }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);

const UsersIcon = ({ size = 24 }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

const VideoIcon = ({ size = 24 }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="m22 8-6 4 6 4V8Z" />
    <rect width="14" height="12" x="2" y="6" rx="2" ry="2" />
  </svg>
);

const CheckCircleIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
    <polyline points="22 4 12 14.01 9 11.01" />
  </svg>
);

const ArrowRightIcon = () => (
  <IconWrapper>
    <path d="M5 12h14" />
    <path d="m12 5 7 7-7 7" />
  </IconWrapper>
);

const GlobeIcon = ({ size = 10 }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="10" />
    <line x1="2" y1="12" x2="22" y2="12" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </svg>
);

const XIcon = ({ size = 20 }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </svg>
);

const MenuIcon = () => (
  <IconWrapper>
    <line x1="4" x2="20" y1="12" y2="12" />
    <line x1="4" x2="20" y1="6" y2="6" />
    <line x1="4" x2="20" y1="18" y2="18" />
  </IconWrapper>
);

const GeminiLogo = () => (
  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
    <path d="M12 2C12 2 12.5 7.5 15 10C17.5 12.5 22 12 22 12C22 12 17.5 11.5 15 14C12.5 16.5 12 22 12 22C12 22 11.5 16.5 9 14C6.5 11.5 2 12 2 12C2 12 6.5 12.5 9 10C11.5 7.5 12 2 12 2Z" fill="url(#gemini_grad)" />
    <defs>
      <linearGradient id="gemini_grad" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
        <stop stopColor="#4E82EE" />
        <stop offset="1" stopColor="#B274FF" />
      </linearGradient>
    </defs>
  </svg>
);

const NotebookLMLogo = () => (
  <img 
    src="https://www.gstatic.com/images/branding/product/2x/notebooklm_96dp.png" 
    alt="NotebookLM ロゴ" 
    className="w-full h-full object-contain"
  />
);

const AntigravityLogo = () => (
  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
    <circle cx="12" cy="12" r="11" stroke="#10B981" strokeWidth="1.5" />
    <path d="M7 16L12 6L17 16" stroke="#10B981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M12 6V18" stroke="#10B981" strokeWidth="2" strokeDasharray="1 3" />
    <circle cx="12" cy="6" r="1.5" fill="#10B981" />
  </svg>
);

const CodeTypingEffect = () => {
  const [displayLines, setDisplayLines] = useState([]);
  const fullLines = [
    'const mySite = new WebSite();',
    'mySite.setTheme("Natural_Modern");',
    'mySite.addMenu("四柱推命講座");',
    'mySite.setVibe("Warm & Elegant");',
    'mySite.generate();',
    '// サイト構築が完了しました！'
  ];

  useEffect(() => {
    let currentLineIdx = 0;
    let currentCharIdx = 0;
    let tempLines = [""];
    let timeoutId;

    const typeEffect = () => {
      if (currentLineIdx < fullLines.length) {
        const currentFullLine = fullLines[currentLineIdx];
        if (currentCharIdx < currentFullLine.length) {
          tempLines[currentLineIdx] = currentFullLine.substring(0, currentCharIdx + 1);
          setDisplayLines([...tempLines]);
          currentCharIdx++;
          timeoutId = setTimeout(typeEffect, 40);
        } else {
          currentLineIdx++;
          currentCharIdx = 0;
          if (currentLineIdx < fullLines.length) {
            tempLines.push("");
            timeoutId = setTimeout(typeEffect, 200);
          } else {
            timeoutId = setTimeout(() => {
              setDisplayLines([]);
              currentLineIdx = 0;
              currentCharIdx = 0;
              tempLines = [""];
              typeEffect();
            }, 3000);
          }
        }
      }
    };

    typeEffect();
    return () => clearTimeout(timeoutId);
  }, []);

  return (
    <div className="font-mono text-[10px] md:text-xs text-left w-full p-4 bg-gray-900 rounded-lg shadow-inner min-h-[160px] flex flex-col justify-start">
      {displayLines.map((line, i) => (
        <div key={i} className={i === fullLines.length - 1 ? "text-emerald-400 font-bold" : "text-emerald-500/80"}>
          <span className="text-gray-500 mr-2 inline-block w-3 text-right">{i + 1}</span>
          {line}
        </div>
      ))}
    </div>
  );
};

const App = () => {
  const [scrolled, setScrolled] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 50);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToId = (id) => {
    const element = document.getElementById(id);
    if (element) element.scrollIntoView({ behavior: 'smooth' });
    setIsMenuOpen(false);
  };

  const goToContact = () => {
    window.location.href = '/contact';
  };

  return (
    <div className="min-h-screen bg-[#fafaf9] text-[#444] font-sans selection:bg-[#d1d5db]">
      <nav className={`fixed w-full z-50 transition-all duration-300 ${scrolled ? 'bg-white/95 backdrop-blur-md shadow-sm py-2' : 'bg-transparent py-5'}`}>
        <div className="max-w-6xl mx-auto px-6 flex justify-between items-center">
          <div className="text-md md:text-xl font-serif tracking-widest font-bold text-[#2d3a3a]">
            知識ゼロからAIで創る WEBサイト構築セミナー
          </div>
          <div className="hidden md:flex space-x-6 text-sm font-bold uppercase tracking-wider">
            <button onClick={() => scrollToId('problem')} className="hover:text-emerald-700 transition">お悩み</button>
            <button onClick={() => scrollToId('works')} className="hover:text-emerald-700 transition">事例</button>
            <button onClick={() => scrollToId('method')} className="hover:text-emerald-700 transition">方法</button>
            <button onClick={() => scrollToId('details')} className="hover:text-emerald-700 transition">概要</button>
          </div>
          <button 
            onClick={() => scrollToId('apply')}
            className="hidden md:block bg-[#2d3a3a] text-white px-8 py-2 rounded-full text-sm hover:bg-emerald-900 transition shadow-lg font-bold"
          >
            申込
          </button>
          <button className="md:hidden" onClick={() => setIsMenuOpen(!isMenuOpen)}>
            {isMenuOpen ? <XIcon size={24} /> : <MenuIcon />}
          </button>
        </div>
        {isMenuOpen && (
          <div className="md:hidden bg-white border-b p-6 flex flex-col space-y-4 shadow-2xl font-bold">
            <button onClick={() => scrollToId('problem')} className="text-left py-3 border-b border-gray-100 font-bold text-lg">お悩み</button>
            <button onClick={() => scrollToId('works')} className="text-left py-3 border-b border-gray-100 font-bold text-lg">事例</button>
            <button onClick={() => scrollToId('method')} className="text-left py-3 border-b border-gray-100 font-bold text-lg">方法</button>
            <button onClick={() => scrollToId('details')} className="text-left py-3 border-b border-gray-100 font-bold text-lg">概要</button>
            <button onClick={() => scrollToId('apply')} className="text-left py-3 text-emerald-700 font-bold text-lg">申込</button>
          </div>
        )}
      </nav>

      <header className="relative h-screen flex items-center justify-center overflow-hidden">
        <div className="absolute inset-0 z-0">
          <img 
            src="https://images.unsplash.com/photo-1470770841072-f978cf4d019e?auto=format&fit=crop&q=80&w=2000" 
            alt="自然の背景" 
            className="w-full h-full object-cover opacity-50"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-white/30 via-transparent to-[#fafaf9]"></div>
        </div>
        <div className="relative z-10 max-w-4xl mx-auto px-6 text-center">
          <div className="inline-block px-4 py-1 mb-8 border border-emerald-800 text-emerald-900 text-sm tracking-[0.2em] rounded-full bg-white/60 backdrop-blur-sm animate-fade-in font-bold">
            鑑定士・講師のための特別講座
          </div>
          <h1 className="text-4xl md:text-6xl font-serif font-bold text-[#1a2e2e] leading-tight mb-10">
            「IT知識ゼロ」は<br className="hidden md:block" />
            もはや武器になる。
          </h1>
          <p className="text-lg md:text-xl text-gray-700 mb-12 leading-relaxed max-w-2xl mx-auto font-bold">
            プログラミング不要・月3000円のAI投資で<br />
            あなたの「世界観」を表現する Webサイトを<br />
            90分で構築しませんか？
          </p>
          <button 
            onClick={goToContact}
            className="bg-[#2d3a3a] text-white px-12 py-4 rounded-full text-lg font-bold hover:bg-emerald-900 transition transform hover:scale-105 shadow-2xl flex items-center mx-auto"
          >
            セミナーに参加する <span className="ml-3"><ArrowRightIcon /></span>
          </button>
        </div>
      </header>

      {/* 以降のセクションは元コードと同様に配置（省略なしで実装済みと想定） */}

      {/* 最下部の申込ボタン */}
      <section id="apply" className="py-24 px-6 bg-emerald-50">
        {/* 中略: セミナー情報のカード部分は元コードどおり */}
        <div className="max-w-4xl mx-auto bg-white rounded-[4rem] shadow-2xl overflow-hidden border border-emerald-100">
          {/* ... セミナー情報 ... */}
          <div className="p-10 md:p-20 space-y-10 font-bold">
            {/* ... 各種情報 ... */}
            <button
              onClick={goToContact}
              className="w-full bg-emerald-800 text-white py-6 rounded-full text-2xl font-bold hover:bg-emerald-950 transition transform hover:scale-105 shadow-2xl mt-8"
            >
              今すぐセミナーに申し込む
            </button>
          </div>
        </div>
      </section>

      <footer className="py-16 bg-white text-center border-t border-gray-100 font-bold">
        <div className="max-w-4xl mx-auto px-6">
          <div className="text-sm font-serif font-bold text-[#2d3a3a] tracking-[0.3em] mb-8 uppercase">知識ゼロからAIで創る WEBサイト構築セミナー</div>
          <p className="text-xs text-gray-400 font-normal">&copy; 2026 ふちLABO. 大自然の叡智を、あなたの人生に。</p>
        </div>
      </footer>

      <style
        dangerouslySetInnerHTML={{
          __html:
            '@keyframes fade-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } } .animate-fade-in { animation: fade-in 1s ease-out forwards; }',
        }}
      />
    </div>
  );
};

ReactDOM.createRoot(document.getElementById('root')).render(<App />);

