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
    window.location.href = 'https://docs.google.com/forms/d/e/1FAIpQLScH97L2WMWei3UnKHAFfN-a0yA94fF0ozKMowE9qkp8nQnAVQ/viewform?usp=dialog';
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

      {/* Question */}
      <section id="problem" className="py-24 px-6 bg-white">
        <div className="max-w-4xl mx-auto text-center font-bold">
          <div className="mb-16">
            <h2 className="text-sm tracking-[0.3em] text-emerald-800 font-bold mb-4 uppercase font-serif">Question</h2>
            <h3 className="text-3xl font-serif font-bold text-[#1a2e2e]">Webサイト、諦めていませんか？</h3>
          </div>
          <div className="grid md:grid-cols-3 gap-8 mb-12 text-left">
            {[
              { title: "高額な費用", text: "制作会社に見積もりをとったら、30万円〜100万円と言われた。", img: "https://images.pexels.com/photos/8250939/pexels-photo-8250939.jpeg?auto=compress&cs=tinysrgb&w=800" },
              { title: "操作の挫折", text: "WixやWordPressを触ってみたけれど、操作が難しくて挫折した。", img: "https://images.pexels.com/photos/8518848/pexels-photo-8518848.jpeg?auto=compress&cs=tinysrgb&w=800" },
              { title: "修正の悩み", text: "修正するたびにお金がかかるので、古い情報のまま放置している。", img: "https://images.pexels.com/photos/8473763/pexels-photo-8473763.jpeg?auto=compress&cs=tinysrgb&w=800" }
            ].map((item, idx) => (
              <div key={idx} className="bg-[#fdfbf7] rounded-3xl border border-gray-100 shadow-lg overflow-hidden flex flex-col h-full">
                <div className="h-56 overflow-hidden">
                  <img src={item.img} alt={item.title} className="w-full h-full object-cover grayscale-[15%] hover:grayscale-0 transition duration-500" />
                </div>
                <div className="p-8 flex-grow bg-white">
                  <div className="w-10 h-10 bg-red-50 rounded-full flex items-center justify-center mb-6 text-red-800 font-bold"><XIcon size={20} /></div>
                  <h4 className="text-xl font-bold mb-4 text-[#1a2e2e]">{item.title}</h4>
                  <p className="text-gray-600 text-sm leading-relaxed font-normal">{item.text}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="bg-emerald-900 text-white p-12 rounded-[2.5rem] shadow-2xl relative overflow-hidden">
            <p className="text-lg md:text-xl leading-relaxed italic relative z-10">
              鑑定士や講師として活動する私たちにとって、Webサイトは「信頼の証」であり、お客様をお迎えする大切な「サロン」です。<br /><br />
              しかし、その構築には多額の費用や膨大な学習時間が必要なのが常識でした……<strong className="text-yellow-200 underline decoration-2 font-bold">これまでは。</strong>
            </p>
            <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -mr-32 -mt-32"></div>
          </div>
        </div>
      </section>

      {/* Results */}
      <section id="works" className="py-24 px-6 bg-[#f7f5f0]">
        <div className="max-w-6xl mx-auto text-center font-bold">
          <div className="mb-16">
            <h2 className="text-sm tracking-[0.3em] text-emerald-800 font-bold mb-4 uppercase font-serif">Results</h2>
            <h3 className="text-3xl font-serif font-bold text-[#1a2e2e] mb-6">このサイト、私が作りました</h3>
            <p className="text-gray-600 mb-10">百聞は一見にしかず。まずは、私の制作例をご覧ください。</p>
            <div className="inline-block relative mb-12">
              <span className="relative z-10 px-6 py-2 font-medium text-emerald-900 italic md:text-lg text-center block">
                「ちなみに、私自身これまでプログラミングを学んだ経験は一切ございません」
              </span>
              <div className="absolute inset-0 bg-emerald-100/60 rounded-lg -rotate-1 transform scale-105 border-b-2 border-emerald-200"></div>
            </div>
          </div>
          <div className="grid md:grid-cols-2 gap-12 text-left">
            <div className="bg-white rounded-3xl overflow-hidden shadow-2xl border border-gray-200 flex flex-col h-full">
              <div className="bg-gray-100 px-4 py-3 border-b flex items-center space-x-1.5 font-bold text-[10px] text-gray-400">
                <GlobeIcon size={12} /> <span>fuchilabo.com/kouza</span>
              </div>
              <div className="aspect-[4/3] w-full overflow-hidden bg-white">
                <iframe src="https://www.fuchilabo.com/kouza" title="事例1" className="w-full h-full border-none" loading="lazy"></iframe>
              </div>
              <div className="p-8 border-t bg-white">
                <h4 className="text-xl font-serif font-bold text-[#1a2e2e] mb-3">講座紹介サイト</h4>
                <a
                  href="https://www.fuchilabo.com/kouza"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center px-4 py-2 text-xs font-bold rounded-full border border-emerald-700 text-emerald-800 hover:bg-emerald-700 hover:text-white transition"
                >
                  サイトを見る
                </a>
              </div>
            </div>
            <div className="bg-white rounded-3xl overflow-hidden shadow-2xl border border-gray-200 flex flex-col h-full">
              <div className="bg-gray-100 px-4 py-3 border-b flex items-center space-x-1.5 font-bold text-[10px] text-gray-400">
                <GlobeIcon size={12} /> <span>fuchilabo.com/products/tetsuya</span>
              </div>
              <div className="aspect-[4/3] w-full overflow-hidden bg-white">
                <iframe src="https://www.fuchilabo.com/products/tetsuya" title="事例2" className="w-full h-full border-none" loading="lazy"></iframe>
              </div>
              <div className="p-8 border-t bg-white">
                <h4 className="text-xl font-serif font-bold text-[#1a2e2e] mb-3">鑑定予約サイト</h4>
                <a
                  href="https://www.fuchilabo.com/products/tetsuya"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center px-4 py-2 text-xs font-bold rounded-full border border-emerald-700 text-emerald-800 hover:bg-emerald-700 hover:text-white transition"
                >
                  サイトを見る
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Innovation / Method */}
      <section id="method" className="py-24 px-6 bg-white">
        <div className="max-w-4xl mx-auto">
          <div className="flex flex-col md:flex-row items-center gap-16">
            <div className="md:w-1/2 font-bold text-center md:text-left">
              <h2 className="text-sm tracking-[0.3em] text-emerald-800 font-bold mb-4 uppercase font-serif text-center md:text-left">Innovation</h2>
              <h3 className="text-3xl font-serif font-bold text-[#1a2e2e] mb-8 leading-tight text-center md:text-left">
                AIがあれば、<br />低コスト・知識不要
              </h3>
              <p className="text-gray-600 mb-8 leading-relaxed font-normal text-left">
                なぜ、そんなことが可能なのか？ それは、2025年から急激に普及し始めた<strong className="text-emerald-700 font-bold">「AIによるコーディング革命」</strong>が起きたからです。
              </p>
              <ul className="space-y-6 text-left">
                {[
                  { title: "高額な外注費は不要", text: "月々約3,000円程度のAIツール利用料だけ。" },
                  { title: "専門知識は不要", text: "HTMLやCSSといった呪文を覚える必要はありません。" },
                  { title: "メンテナンスも自由自在", text: "AIにチャットで頼むだけで色変更やメニュー追加が可能。" }
                ].map((item, idx) => (
                  <li key={idx} className="flex items-start">
                    <div className="mt-1 bg-emerald-100 p-1 rounded-full text-emerald-700 mr-4 text-xs flex-shrink-0 font-bold"><CheckCircleIcon /></div>
                    <div>
                      <strong className="text-[#1a2e2e] font-bold block mb-1">{item.title}:</strong>
                      <span className="text-gray-600 text-sm font-normal">{item.text}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
            <div className="md:w-1/2 relative">
              <div className="aspect-square bg-emerald-50 rounded-full flex items-center justify-center p-12 shadow-inner border border-emerald-100/50">
                <div className="bg-white w-full h-full rounded-[2.5rem] shadow-2xl flex flex-col items-center justify-center p-6 text-center space-y-4 overflow-hidden border border-emerald-100 relative">
                  <div className="w-16 h-16 bg-emerald-700 text-white rounded-full flex items-center justify-center animate-pulse z-10"><CpuIcon size={32} /></div>
                  <div className="z-10 w-full">
                    <CodeTypingEffect />
                  </div>
                  <div className="text-sm font-bold text-emerald-800 z-10 uppercase tracking-widest">AI Generating...</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Vibe Coding */}
      <section className="py-24 px-6 bg-emerald-950 text-white overflow-hidden relative">
        <div className="absolute top-0 right-0 opacity-10 pointer-events-none transform translate-x-1/4 -translate-y-1/4">
          <SparklesIcon size={600} />
        </div>
        <div className="max-w-4xl mx-auto relative z-10 text-center font-bold">
          <h2 className="text-sm tracking-[0.3em] text-emerald-400 font-bold mb-4 uppercase font-serif">Method</h2>
          <h3 className="text-3xl md:text-5xl font-serif font-bold mb-10 leading-tight">手法解説：<br />「バイブコーディング」とは？</h3>
          <p className="text-lg text-emerald-100 leading-relaxed mb-16 max-w-3xl mx-auto text-center font-normal">
            難しいコードを書くのではなく、<strong className="text-white border-b-2 border-emerald-400 font-bold">「AIにやりたいことを熱量（バイブス）を持って伝える」</strong>だけで、AIが裏側でプログラムを書いてくれる新しい開発スタイルです。
          </p>
          <div className="grid md:grid-cols-2 gap-10 text-left">
            <div className="bg-white/10 backdrop-blur-md p-12 rounded-[2.5rem] border border-white/20">
              <h4 className="text-xl font-bold mb-4 flex items-center"><span className="mr-4 text-emerald-400 font-bold"><UsersIcon /></span> 参謀・デザイナー</h4>
              <p className="text-emerald-50/80 leading-relaxed font-normal">パソコンの中に「24時間、文句を言わずに働いてくれる超優秀なWebデザイナー」が住んでいるようなものです。</p>
            </div>
            <div className="bg-white/10 backdrop-blur-md p-12 rounded-[2.5rem] border border-white/20">
              <h4 className="text-xl font-bold mb-4 flex items-center"><span className="mr-4 text-emerald-400 font-bold"><MousePointerIcon /></span> 魔法のような体験</h4>
              <p className="text-emerald-50/80 leading-relaxed font-normal">あなたは「こんな雰囲気で」と伝えるだけ。まさに魔法のように、あなたの想いが形になります。</p>
            </div>
          </div>
        </div>
      </section>

      {/* Program & Tools */}
      <section id="details" className="py-24 px-6 bg-white">
        <div className="max-w-6xl mx-auto text-center font-bold">
          <div className="mb-20">
            <h2 className="text-sm tracking-[0.3em] text-emerald-800 font-bold mb-4 uppercase font-serif">Program</h2>
            <h3 className="text-3xl font-serif font-bold text-[#1a2e2e] mb-8">90分で「魔法」の裏側を見せます</h3>
            <p className="text-gray-600 mb-6 font-normal">本セミナーでは、難しい理論は抜きにして制作の「そのままの現場」を実演形式でお見せいたします</p>
            <div className="bg-emerald-50 text-emerald-900 px-8 py-3 rounded-2xl border border-emerald-200 inline-block">
              難しい話は一切ありません。AIとのチャット会話だけで、すべてが完結します。
            </div>
          </div>
          <h4 className="text-center text-xl font-bold mb-12 text-[#1a2e2e]">使用する「3種の神器」</h4>

          <div className="grid md:grid-cols-3 gap-8 mb-20">
            {[
              { 
                name: "Gemini", 
                kana: "ジェミニ",
                role: "参謀・デザイナー", 
                desc: "GoogleのAI。サイトの構成案や、心に響く文章、美しいビジュアルを一緒に考えてくれます。",
                Logo: GeminiLogo,
                image: "https://images.pexels.com/photos/4968672/pexels-photo-4968672.jpeg?auto=compress&cs=tinysrgb&w=800"
              },
              { 
                name: "NotebookLM", 
                kana: "ノートブックエルエム",
                role: "秘書・書記", 
                desc: "あなたの頭の中にアイデアや資料を読み込ませ、サイトに必要な情報を整理・保管します。",
                Logo: NotebookLMLogo,
                image: "https://images.pexels.com/photos/1370298/pexels-photo-1370298.jpeg?auto=compress&cs=tinysrgb&w=800"
              },
              { 
                name: "Antigravity", 
                kana: "アンチグラビティ",
                role: "建築家・エンジニア", 
                desc: "指示通りにWebサイトの形を一瞬で組み上げてくれる、魔法のような構築ツールです。",
                Logo: AntigravityLogo,
                image: "https://images.pexels.com/photos/4976712/pexels-photo-4976712.jpeg?auto=compress&cs=tinysrgb&w=800"
              }
            ].map((tool, idx) => (
              <div key={idx} className="bg-white rounded-[2.5rem] border border-gray-100 shadow-2xl overflow-hidden h-full flex flex-col transition hover:shadow-emerald-100">
                <div className="w-full h-48 lg:h-56 relative bg-gray-100 overflow-hidden group">
                  <img src={tool.image} alt={tool.name} className="absolute inset-0 w-full h-full object-cover transition duration-500 group-hover:scale-110" />
                  <div className="absolute top-4 left-4 w-12 h-12 bg-white/95 backdrop-blur-md rounded-2xl shadow-xl border border-gray-100 flex items-center justify中心 p-2.5 z-20">
                    <tool.Logo />
                  </div>
                  <div className="absolute inset-0 bg-black/5 pointer-events-none"></div>
                </div>
                <div className="p-8 flex-grow">
                  <div className="mb-4">
                    <h5 className="text-2xl font-serif font-bold text-[#1a2e2e] leading-none mb-1">{tool.name}</h5>
                    <span className="text-[10px] text-gray-400 font-bold tracking-widest uppercase block mb-1">{tool.kana}</span>
                  </div>
                  <span className="inline-block bg-emerald-50 text-emerald-800 text-xs font-bold px-4 py-1 rounded-full mb-5 uppercase tracking-tighter">役割: {tool.role}</span>
                  <p className="text-gray-600 text-sm leading-relaxed text-left font-normal">{tool.desc}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="bg-[#f7f5f0] p-12 rounded-[3rem] border border-gray-100 text-left shadow-lg">
            <h4 className="text-2xl font-serif font-bold text-center mb-12 text-[#1a2e2e]">このセミナーで得られるもの</h4>
            <div className="grid md:grid-cols-2 gap-12">
              {[
                "知識ゼロからサイトが出来上がる「衝撃の工程」を目撃できます",
                "「私にもできるかも！」という自信と具体的な一歩の踏み出し方",
                "制作会社に依存せず、自分でビジネスを育てる自由を得る方法",
                "WEBサイト作成の具体的なAIの組み合わせ方と使い方"
              ].map((text, idx) => (
                <div key={idx} className="flex items-center space-x-6">
                  <div className="flex-shrink-0 w-10 h-10 bg-emerald-800 text-white rounded-full flex items-center justify-center text-base font-bold shadow-md">{idx + 1}</div>
                  <p className="text-gray-700 font-medium text-sm md:text-base font-bold">{text}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Apply */}
      <section id="apply" className="py-24 px-6 bg-emerald-50">
        <div className="max-w-4xl mx-auto bg-white rounded-[4rem] shadow-2xl overflow-hidden border border-emerald-100">
          <div className="bg-emerald-900 text-white p-12 text-center font-bold">
            <h2 className="text-sm tracking-widest mb-4 opacity-80 uppercase font-serif">Seminar Info</h2>
            <h3 className="text-2xl md:text-4xl font-serif font-bold leading-tight">知識ゼロからAIで創る<br />WEBサイト構築セミナー</h3>
          </div>
          <div className="p-10 md:p-20 space-y-10 font-bold">
            <div className="flex items-center space-x-6 pb-6 border-b border-gray-50 text-lg">
              <span className="text-emerald-800"><ClockIcon size={32} /></span>
              <div>
                <p className="text-xs text-gray-400 font-bold uppercase tracking-wider mb-1">開催日時</p>
                <p>2026年2月15日（日） 21:00 ～ 22:30</p>
              </div>
            </div>
            <div className="flex items-center space-x-6 pb-6 border-b border-gray-50 text-lg">
              <span className="text-emerald-800"><VideoIcon size={32} /></span>
              <div>
                <p className="text-xs text-gray-400 font-bold uppercase tracking-wider mb-1">開催場所</p>
                <p>オンライン（ZOOM）</p>
              </div>
            </div>
            <div className="flex items-center space-x-6 pb-6 border-b border-gray-50 text-lg">
              <span className="text-emerald-800 font-bold"><UsersIcon size={32} /></span>
              <div>
                <p className="text-xs text-gray-400 font-bold uppercase tracking-wider mb-1">定員</p>
                <p>先着5名さま（お早めにお申し込みください）</p>
              </div>
            </div>
            <div className="flex items-center space-x-6">
              <div className="w-14 h-14 bg-emerald-100 rounded-full flex items-center justify-center text-emerald-800 font-bold text-2xl border border-emerald-200">¥</div>
              <div>
                <p className="text-xs text-gray-400 font-bold uppercase tracking-wider mb-1">参加費</p>
                <p className="text-3xl font-bold text-emerald-800">5,000円<span className="text-sm ml-2 font-normal text-gray-500 font-normal">(税込)</span></p>
                <p className="text-xs text-gray-400 font-normal mt-1">※一般的な制作費の1/100以下の投資でスキルの身につけ方が分かります。</p>
              </div>
            </div>
            <div className="bg-[#fdfbf7] p-8 rounded-3xl border border-dashed border-emerald-300 font-bold">
              <h5 className="text-emerald-800 mb-2 flex items-center text-sm uppercase tracking-wider"><VideoIcon size={16} className="mr-2" /> 【特別特典】</h5>
              <p className="text-gray-600 text-sm font-normal">当日のアーカイブ動画をプレゼント。後から何度でも見返して実践できます。</p>
            </div>
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

