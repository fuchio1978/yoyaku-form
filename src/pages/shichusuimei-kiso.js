const { renderPage } = require('../utils/render');

const SHICHUSUIMEI_KISO_PRODUCT = {
  id: 'shichusuimei-kiso',
  title: '四柱推命 基礎完成講座',
  price: 30000,
  currency: '¥',
  image: '/shichusuimei-kiso-hero.png',
  summary: '陰陽五行・十干十二支・蔵干・通変星をつなげ、日柱を根拠を持って読める状態を目指す全6回のオンライン講座です。',
  benefit: '暗記ではなく「なぜそうなるのか」を学び、日柱を自分の言葉で読める基礎を作ります。',
  details: [
    '全6回・各回90分（講義60分＋質問30分）',
    '2026年8月22日〜10月31日／土曜日16:00〜17:30',
    'オンライン（Zoom）・全講義アーカイブあり',
    '定員20名',
  ],
  duration: '全6回（約3か月）',
  typeLabel: 'オンライン・グループ講座',
  requiresSchedule: false,
  personId: 'tetsuya',
  providerLabel: '講師：てつ先生',
  isHidden: true,
  displayOrder: 99,
};

function renderShichusuimeiKisoPage(options = {}) {
  const previewKey = options.previewKey || '';
  const previewQuery = previewKey ? `?preview=${encodeURIComponent(previewKey)}` : '';
  const ctaUrl = options.ctaUrl || `/products/shichusuimei-kiso${previewQuery}`;
  const lineUrl = process.env.KOUZA_LINE_URL || '/contact';
  const headExtras = `
    <meta name="description" content="暗記ではなく、陰陽五行・十干十二支・蔵干・通変星のつながりを学び、日柱を自分の言葉で読める状態を目指す全6回のオンライン講座です。" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
  `;

  const cta = (note = '全6回・アーカイブあり｜30,000円（税込）') => `
    <div class="kiso-cta-block">
      <a class="kiso-button" href="${ctaUrl}">基礎完成講座に申し込む <span aria-hidden="true">→</span></a>
      <p>${note}</p>
    </div>
  `;

  const content = `
    <section class="kiso-hero">
      <div class="kiso-shell kiso-hero-grid">
        <div class="kiso-hero-copy">
          <p class="kiso-kicker">テキストを覚えるだけの学びから、<br />「自分で読める」四柱推命へ。</p>
          <h1><small>ゼロから日柱鑑定まで</small>四柱推命・<br />基礎完成講座</h1>
          <p class="kiso-hero-lead">陰陽五行・十干十二支・通変星を、<br />暗記ではなく「なぜそうなるのか」という<br />つながりで学びます。</p>
          <p class="kiso-hero-body">自分や身近な人の日柱を、根拠を持って読める状態を目指す全6回の講座です。完全初心者の方もご参加いただけます。</p>
          <div class="kiso-meta-row" aria-label="講座概要">
            <span>全6回</span><span>オンライン</span><span>アーカイブあり</span><span>定員20名</span>
          </div>
          ${cta('2026年8月22日スタート｜30,000円（税込）')}
        </div>
        <figure class="kiso-hero-image">
          <img src="/shichusuimei-kiso-hero.png" alt="ホワイトボードを使って四柱推命を解説する講師" loading="eager" />
        </figure>
      </div>
    </section>

    <section class="kiso-section kiso-section-soft">
      <div class="kiso-shell kiso-narrow">
        <div class="kiso-heading">
          <p>こんな状態になっていませんか</p>
          <h2>本やテキストは読んだ。<br />でも、命式を前にすると<br />言葉が出てこない。</h2>
        </div>
        <ul class="kiso-check-list kiso-card">
          <li>四柱推命に興味はあるけれど、何から学べばよいかわからない</li>
          <li>十干や通変星の意味を覚えても、鑑定でどう使えばよいかわからない</li>
          <li>本や講座で学んだ知識が、バラバラになっている</li>
          <li>日柱を見ても、説明文を思い出すことしかできない</li>
          <li>自分の読み方に根拠が持てず、鑑定に踏み出せない</li>
          <li>用神を学びたいけれど、その前の基礎で止まっている</li>
        </ul>
        <div class="kiso-message">
          <p>これは、才能がないからではありません。<br />知識が足りないからでもありません。</p>
          <strong>「覚えた知識」と「鑑定で使える知識」の間に、<br />まだ橋がかかっていない状態です。</strong>
        </div>
      </div>
    </section>

    <section class="kiso-section kiso-section-deep">
      <div class="kiso-shell kiso-two-col">
        <div>
          <p class="kiso-eyebrow">WHY IT DOESN'T CONNECT</p>
          <h2>原因は、基礎を知らないことではありません。<br /><em>基礎が「つながっていないこと」</em>です。</h2>
          <p>陰陽五行、十干十二支、蔵干、通変星。それぞれの意味を単独で覚えるだけでは、命式を読めるようにはなりません。</p>
          <p>数学で、公式だけを覚えても応用問題が解けないのと同じです。基礎の仕組みがわかっていれば、迷った時に戻って考え直せます。四柱推命にも、その「戻る場所」が必要です。</p>
        </div>
        <div class="kiso-question-card">
          <p>なぜ丁は炎として読むのか</p>
          <p>なぜ酉の蔵干は庚・辛なのか</p>
          <p>なぜ丁から見た辛は偏財になるのか</p>
          <span>つながりが見えると、暗記に頼らず自分で考えて言葉を作れるようになります。</span>
        </div>
      </div>
    </section>

    <section class="kiso-section">
      <div class="kiso-shell kiso-narrow">
        <div class="kiso-heading">
          <p>この講座が目指す「基礎完成」</p>
          <h2>すべてを暗記することが、<br />基礎完成ではありません。</h2>
        </div>
        <div class="kiso-flow-line" aria-label="学習内容のつながり">
          <span>陰陽五行</span><b>→</b><span>十干十二支</span><b>→</b><span>蔵干</span><b>→</b><span>通変星</span><b>→</b><span>日柱鑑定</span>
        </div>
        <div class="kiso-prose">
          <p>この講座でいう「基礎完成」とは、陰陽五行・十干十二支・蔵干・通変星を、一本の流れとして理解できる状態です。</p>
          <p>「この干支だから、この性質です」と結論だけを覚えるのではなく、「この五行関係があるから、このような景色と性質が生まれます」と、自分の言葉で説明できる状態を目指します。</p>
        </div>
        <blockquote>バラバラだった知識をつなげて、<br />日柱を自分の頭で読めるようになる。<br /><strong>それが、この講座が目指す「基礎完成」です。</strong></blockquote>
      </div>
    </section>

    <section class="kiso-section kiso-section-soft">
      <div class="kiso-shell">
        <div class="kiso-heading">
          <p>受講後にできるようになること</p>
          <h2>講座を終えた時、<br />目指すのはこの状態です。</h2>
        </div>
        <div class="kiso-goal-grid">
          <article><span>01</span><p>万年暦を使い、自分で正確な命式を出せる</p></article>
          <article><span>02</span><p>陰陽五行の関係を、自分の言葉で説明できる</p></article>
          <article><span>03</span><p>十干と十二支を、自然の景色として捉えられる</p></article>
          <article><span>04</span><p>蔵干と通変星が、どうつながるか理解できる</p></article>
          <article><span>05</span><p>日柱一本から、性質を根拠を持って読める</p></article>
          <article><span>06</span><p>自分や身近な人の日柱を、簡単に説明できる</p></article>
          <article><span>07</span><p>用神を学ぶために必要な土台が整う</p></article>
        </div>
        <div class="kiso-notice"><strong>この講座で目指す範囲について</strong><p>この講座だけで、四柱全体を使った本格鑑定や、用神の決定までできるようになるわけではありません。まずは、日柱を自分の力で読める状態を作ります。その土台が、その後の四柱鑑定や用神の学びにつながります。</p></div>
        ${cta()}
      </div>
    </section>

    <section class="kiso-section">
      <div class="kiso-shell kiso-two-col kiso-reason-grid">
        <div class="kiso-reason-visual" aria-hidden="true"><span>時柱</span><strong>日柱</strong><span>月柱</span><span>年柱</span></div>
        <div>
          <p class="kiso-eyebrow">WHY THE DAY PILLAR?</p>
          <h2>最初から四柱すべてを読もうとしない。<br />まずは一本を、深く読めるようにする。</h2>
          <p>初心者が最初から八文字すべてを読もうとすると、情報量が多くなりすぎます。そこで、この講座では日柱一本に絞ります。</p>
          <p>一本の中にある陰陽・五行・干支・蔵干・通変星を丁寧につないで読むことで、四柱全体を学ぶための基本動作を身につけます。</p>
          <strong class="kiso-inline-em">一本を深く読めることで、四柱で読む力が大きく伸びます。</strong>
        </div>
      </div>
    </section>

    <section id="curriculum" class="kiso-section kiso-section-deep">
      <div class="kiso-shell">
        <div class="kiso-heading kiso-heading-light">
          <p>全6回のカリキュラム</p>
          <h2>知識の位置を確かめながら、<br />日柱鑑定まで進みます。</h2>
        </div>
        <div class="kiso-curriculum">
          <article><div><span>第1回</span><time>8/22</time></div><h3>万年暦を使って命式を出す</h3><p>自分や身近な人の生年月日から、命式に並ぶ八文字を出します。最初に実際の命式を見ることで、その後の知識がどこで使われるのかを確認します。</p></article>
          <article><div><span>第2回</span><time>9/5</time></div><h3>陰陽五行と五行の関係</h3><p>陰と陽の違い、木・火・土・金・水の性質、相生・相剋・比和の関係。四柱推命のすべての土台となる世界観を学びます。</p></article>
          <article><div><span>第3回</span><time>9/19</time></div><h3>十干を自然の景色として理解する</h3><p>甲から癸までの十干を、単語の暗記ではなく自然の景色として学び、それぞれの性質がなぜその意味になるのかを整理します。</p></article>
          <article><div><span>第4回</span><time>10/3</time></div><h3>十二支と蔵干を理解する</h3><p>十二支を季節や時間、自然の変化として学びます。十二支の中にある蔵干が、命式でどのように働くのかを見ていきます。</p></article>
          <article><div><span>第5回</span><time>10/17</time></div><h3>通変星が生まれる仕組みを理解する</h3><p>十種類の意味を丸暗記せず、日干と他の干の関係から通変星が生まれる仕組みを学びます。</p></article>
          <article><div><span>第6回</span><time>10/31</time></div><h3>日柱鑑定の実践と、四柱の基本的な見方</h3><p>学んだ要素を組み合わせ、実際に日柱を読みます。鑑定の言葉として伝える練習と、四本の柱それぞれの役割も確認します。</p></article>
        </div>
      </div>
    </section>

    <section class="kiso-section kiso-section-soft">
      <div class="kiso-shell">
        <div class="kiso-heading"><p>この講座ならではの特徴</p><h2>覚えるためではなく、<br />自分で考えられるようになるために。</h2></div>
        <div class="kiso-feature-grid">
          <article><span>01</span><h3>暗記より「なぜ」を大切に</h3><p>結論だけでなく、そこへ至る考え方を学びます。忘れても基礎へ戻り、自分で考え直せる状態を目指します。</p></article>
          <article><span>02</span><h3>難しい内容を省略しない</h3><p>大切な部分を飛ばさず、細かく分け、わかる言葉で説明します。</p></article>
          <article><span>03</span><h3>毎回30分の質問時間</h3><p>質問し、言葉にし、対話することで知識を自分のものにします。他の受講者の質問も気づきにつながります。</p></article>
          <article><span>04</span><h3>アーカイブで反復学習</h3><p>全講義を動画でお渡しします。一度で理解できなくても、繰り返し見直せます。</p></article>
          <article><span>05</span><h3>流派を越えた基礎を扱う</h3><p>陰陽五行・十干十二支・蔵干・通変星という、多くの流派で使われる土台を学びます。</p></article>
        </div>
      </div>
    </section>

    <section class="kiso-section">
      <div class="kiso-shell kiso-teacher">
        <figure><img src="/touyou-instructor.jpg" alt="講師 てつ先生" loading="lazy" /></figure>
        <div>
          <p class="kiso-eyebrow">INSTRUCTOR</p>
          <h2>10年以上の大学受験指導の現場で培った、<br />「わからない場所を見つける力」を使います。</h2>
          <p>わたしは10年以上、高校生の学習指導に関わってきました。一生懸命勉強しているのに成績が伸びない時、本人の能力ではなく、基礎のどこかに小さな抜けが残っていることがあります。</p>
          <p>その抜けを見つけ、わかるところまで戻り、もう一度つなげる。四柱推命でも、同じことが起きています。</p>
          <p>知識は持っている。それでも命式を読めない。そんな方がどこで止まっているのかを見つけ、知識をつなぎ直す講座を作りたい。それが、この講座を作った理由です。</p>
          <p class="kiso-teacher-name"><strong>てつ先生</strong><span>自然派四柱推命講師・鑑定士</span></p>
        </div>
      </div>
    </section>

    <section class="kiso-section kiso-section-soft">
      <div class="kiso-shell">
        <div class="kiso-heading"><p>この講座が合う方</p><h2>お申し込み前に、<br />ご自身の目的と照らし合わせてください。</h2></div>
        <div class="kiso-fit-grid">
          <article class="is-good"><h3>おすすめする方</h3><ul><li>四柱推命を初めて学ぶ方</li><li>一度学んだけれど、基礎から学び直したい方</li><li>暗記した知識を鑑定につなげられていない方</li><li>自分や身近な人の日柱を読めるようになりたい方</li><li>鑑定の言葉に根拠を持ちたい方</li><li>将来、用神や四柱全体の鑑定を学びたい方</li></ul></article>
          <article class="is-not"><h3>おすすめしない方</h3><ul><li>短期間で四柱全体の鑑定を完成させたい方</li><li>用神の出し方だけを知りたい方</li><li>暗記用の答えや鑑定文だけを求めている方</li><li>講義を聞くだけで、練習や復習をしたくない方</li></ul></article>
        </div>
      </div>
    </section>

    <section class="kiso-section">
      <div class="kiso-shell">
        <div class="kiso-heading"><p>受講の流れ</p><h2>お申し込みから受講後まで</h2></div>
        <div class="kiso-steps">
          <article><span>1</span><h3>お申し込み</h3><p>申込フォームを送信し、完了メールと講座参加のご案内を受け取ります。</p></article>
          <article><span>2</span><h3>講座当日</h3><p>Zoomで受講。講義60分のあと、質問時間を30分設けます。</p></article>
          <article><span>3</span><h3>講座後</h3><p>アーカイブ動画で復習し、次回までに簡単な復習や実践を行います。</p></article>
        </div>
      </div>
    </section>

    <section class="kiso-section kiso-section-deep" id="outline">
      <div class="kiso-shell">
        <div class="kiso-heading kiso-heading-light"><p>開催概要</p><h2>3か月かけて、<br />四柱推命の基礎をつなぎ直します。</h2></div>
        <div class="kiso-outline">
          <dl><div><dt>講座名</dt><dd>四柱推命 基礎完成講座</dd></div><div><dt>形式</dt><dd>オンライン・グループ講座（Zoom）</dd></div><div><dt>回数・時間</dt><dd>全6回／各回90分（講義60分＋質問30分）</dd></div><div><dt>日程</dt><dd>2026年 8/22、9/5、9/19、10/3、10/17、10/31<br /><small>すべて土曜日 16:00〜17:30</small></dd></div><div><dt>定員</dt><dd><strong>20名</strong></dd></div><div><dt>アーカイブ</dt><dd>全講義あり</dd></div><div><dt>お支払い</dt><dd>銀行振込<br /><small>※お振込み手数料はお客さまのご負担となります</small></dd></div></dl>
          <div class="kiso-price"><p>受講料</p><strong>30,000<small>円（税込）</small></strong><span>全6回・1回あたり5,000円</span><p class="kiso-price-copy">動画を見るだけではなく、毎回の質問時間と日柱を使った実践を通して、その後の鑑定や用神の学びにも使い続けられる土台を作ります。</p></div>
        </div>
        ${cta('定員20名｜2026年8月22日スタート')}
      </div>
    </section>

    <section class="kiso-section kiso-section-soft">
      <div class="kiso-shell kiso-narrow">
        <div class="kiso-heading"><p>よくある質問</p><h2>お申し込み前のご確認</h2></div>
        <div class="kiso-faq">
          <details><summary>四柱推命をまったく学んだことがなくても参加できますか？</summary><p>参加できます。専門用語を知っていることを前提にせず、命式を出すところから始めます。</p></details>
          <details><summary>すでに別の流派で学んでいますが、参加できますか？</summary><p>参加できます。多くの流派で土台となる内容を扱います。ただし、細かな解釈や蔵干の取り方には流派による違いがあるため、講座で採用する考え方も明確にお伝えします。</p></details>
          <details><summary>欠席した場合はどうなりますか？</summary><p>全講義のアーカイブをお渡しします。当日参加できない回も、後日視聴できます。</p></details>
          <details><summary>この講座で鑑定士になれますか？</summary><p>この講座だけで四柱全体を使った本格鑑定が完成するわけではありません。まずは日柱一本を根拠を持って読める状態を目指す、基礎の講座です。</p></details>
          <details><summary>用神の出し方も学べますか？</summary><p>用神の決定方法そのものは中心に扱いません。用神を考える前提となる基礎を完成させます。</p></details>
          <details><summary>質問はできますか？</summary><p>毎回、講義後に30分の質問時間を設けます。</p></details>
          <details><summary>スマートフォンだけでも参加できますか？</summary><p>Zoomの受講自体は可能です。ただし、命式や資料を見るため、パソコンまたはタブレットがあると学びやすいです。</p></details>
          <details><summary>キャンセルや返金について教えてください。</summary><p>お申し込み前に、申込ページの利用規約・キャンセル規定をご確認ください。</p></details>
        </div>
      </div>
    </section>

    <section class="kiso-final">
      <div class="kiso-shell kiso-narrow">
        <p class="kiso-eyebrow">A MESSAGE FOR YOU</p>
        <h2>わからないまま先へ進む学びを、<br />ここで一度終わりにしませんか。</h2>
        <div class="kiso-prose">
          <p>四柱推命には、たくさんの知識があります。すべてを覚えてから鑑定しようとすると、いつまでたっても始められません。</p>
          <p>大切なのは、知識の量ではありません。今持っている知識が、どのようにつながっているのか。命式を見た時に、どこへ戻れば自分で考え直せるのか。その土台を作ることです。</p>
          <p>初めての方には基礎を一から積み上げる場に。一度学んだ方には、バラバラになった知識をつなぎ直す場になります。</p>
        </div>
        <strong class="kiso-final-line">日柱一本を、自分の言葉で読めるようになる。<br />そこから、四柱推命の学びはもっと面白くなります。</strong>
        ${cta('全6回・アーカイブあり｜受講料30,000円（税込）｜定員20名')}
        <p class="kiso-contact-note">お申し込み前に確認したいことがある方は、<a href="${lineUrl}" target="_blank" rel="noopener noreferrer">公式LINE</a>からお問い合わせください。</p>
      </div>
    </section>

    <div class="kiso-sticky-cta"><a href="${ctaUrl}">基礎完成講座に申し込む</a></div>
  `;

  return renderPage({
    title: '四柱推命 基礎完成講座｜ふちLABO.',
    content,
    hideHeading: true,
    bodyClass: 'kiso-body',
    pageClass: 'kiso-page',
    headExtras,
  });
}

module.exports = { renderShichusuimeiKisoPage, SHICHUSUIMEI_KISO_PRODUCT };
