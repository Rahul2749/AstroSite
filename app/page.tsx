'use client';

import { useEffect, useState } from 'react';
import { Sun, TempleArt, JournalArt } from '@/components/artwork';
import { BirthAtlasHero } from '@/components/birth-atlas-hero';
import { Booking } from '@/components/booking';
import { ContentDialog } from '@/components/content-dialog';
import { services, rashis, articles } from '@/lib/content';
import { hindiServices, hindiRashis, hindiArticles } from '@/lib/hindi-content';
import { translate, type Language } from '@/lib/language';

const Arrow = () => <span aria-hidden="true">↗</span>;
const languageKey = 'veda-language';

export default function Home() {
  const [language, setLanguage] = useState<Language>('en');
  const [booking, setBooking] = useState<number | null>(null);
  const [menu, setMenu] = useState(false);
  const [allServices, setAllServices] = useState(false);
  const [rashi, setRashi] = useState(0);
  const [content, setContent] = useState<{ title: string; body: string[] } | null>(null);

  useEffect(() => {
    try {
      if (localStorage.getItem(languageKey) === 'hi') setLanguage('hi');
    } catch { /* The switch works without storage. */ }
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
    document.title = language === 'hi'
      ? 'वेदा — आपके जन्म का आकाश'
      : 'Vedā — The sky you were born under';
  }, [language]);

  function chooseLanguage(next: Language) {
    setLanguage(next);
    setMenu(false);
    try {
      localStorage.setItem(languageKey, next);
    } catch { /* The switch works without storage. */ }
  }

  const t = translate(language);
  const isHindi = language === 'hi';
  const serviceList = isHindi ? hindiServices : services;
  const rashiList = isHindi ? hindiRashis : rashis;
  const journal = isHindi ? hindiArticles : articles;
  const current = rashiList[rashi];
  const navItems = [
    [t('Our approach', 'हमारा नज़रिया'), 'about'],
    [t('Consultations', 'परामर्श'), 'services'],
    [t('The Rashis', 'राशियाँ'), 'rashis'],
    [t('Journal', 'लेख'), 'journal'],
  ];
  const steps = [
    [t('Choose your focus', 'परामर्श चुनें'), t('Find a consultation that meets you where you are.', 'अपने सवाल के हिसाब से परामर्श चुनें।')],
    [t('Make a little time', 'समय तय करें'), t('Pick a day and time that fits into your life.', 'अपनी सुविधा का दिन और समय चुनें।')],
    [t('Share your story', 'अपनी बात बताएँ'), t('Tell us what’s on your mind and, if needed, your birth details.', 'अपना सवाल बताएँ और ज़रूरत हो तो जन्म का विवरण दें।')],
    [t('Find a fresh perspective', 'नए नज़रिए से देखें'), t('Make room for reflection in a personal, online conversation.', 'ऑनलाइन, आमने-सामने की बातचीत में अपने सवाल पर विचार करें।')],
  ];
  const faqs = [
    [t('What can I expect from a consultation?', 'परामर्श में क्या होगा?'),
      t('A focused, one-to-one conversation about your selected topic, interpreted through the tradition of Vedic astrology. The aim is reflection and perspective; no outcome or prediction is guaranteed.',
        'आप अपने चुने हुए विषय पर वैदिक ज्योतिष की परंपरा के आधार पर आमने-सामने बात करेंगे। इसका उद्देश्य आपको सोचने और नए नज़रिए से देखने में मदद करना है। किसी नतीजे या भविष्यवाणी की गारंटी नहीं है।')],
    [t('Do I need to know my birth time?', 'क्या जन्म का समय जानना ज़रूरी है?'),
      t('Birth-chart and planetary consultations ask for your birth date, time, and place. If you do not know the time, select “I don’t know my birth time” in the booking form. General and Vastu consultations do not require birth information.',
        'कुंडली और ग्रह दशा के परामर्श के लिए जन्मतिथि, जन्म समय और जन्म स्थान पूछा जाता है। समय न मालूम हो तो बुकिंग फ़ॉर्म में “मुझे अपना जन्म समय नहीं पता” चुनें। सामान्य और वास्तु परामर्श के लिए जन्म का विवरण ज़रूरी नहीं है।')],
    [t('How much does a consultation cost?', 'परामर्श का शुल्क कितना है?'),
      t('Consultations are priced from ₹200 to ₹499 and last 15–30 minutes. Your selected price and total are shown before checkout.',
        'परामर्श का शुल्क ₹200 से ₹499 है और अवधि 15–30 मिनट है। भुगतान से पहले चुना हुआ शुल्क और कुल राशि दिखती है।')],
    [t('Can I book and pay right now?', 'क्या अभी बुकिंग और भुगतान कर सकते हैं?'),
      t('The booking window shows whether checkout is open. When enabled, select an available time and pay through Razorpay. Only verified payment confirms an appointment. Test mode is clearly labelled.',
        'बुकिंग विंडो में दिखता है कि भुगतान शुरू है या नहीं। उपलब्ध होने पर समय चुनकर Razorpay से भुगतान करें। जाँच के बाद ही परामर्श तय होता है। परीक्षण मोड अलग से दिखता है।')],
    [t('Can I reschedule or cancel?', 'क्या मैं समय बदल या बुकिंग रद्द कर सकता हूँ?'),
      t('Contact the support address in your booking email for a change. The administrator can reschedule or cancel your appointment with a full refund. Review the booking terms before payment.',
        'बदलाव के लिए बुकिंग ईमेल में दिए सहायता संपर्क से बात करें। व्यवस्थापक समय बदल सकते हैं या पूरा रिफ़ंड देकर परामर्श रद्द कर सकते हैं। भुगतान से पहले शर्तें पढ़ें।')],
    [t('How are my details handled?', 'मेरी जानकारी का क्या होता है?'),
      t('When checkout begins, your contact and consultation details are stored to arrange the appointment. Administrators can access these details. Payment information is handled by Razorpay, and appointment emails are sent through Resend.',
        'भुगतान शुरू करते समय आपका संपर्क और परामर्श का विवरण सहेजा जाता है। व्यवस्थापक यह विवरण देख सकते हैं। भुगतान का विवरण Razorpay सँभालता है और परामर्श के ईमेल Resend से भेजे जाते हैं।')],
  ];

  function showPolicy(policy: 'privacy' | 'terms') {
    setContent(policy === 'privacy' ? {
      title: t('Your privacy', 'आपकी गोपनीयता'),
      body: [
        t('Starting checkout saves your name, email, selected time, consent, and consultation details. These are used to arrange the appointment. Birth details and private notes stay out of notification emails.',
          'भुगतान शुरू करने पर नाम, ईमेल, समय, सहमति और परामर्श का विवरण सहेजा जाता है। इनसे परामर्श की तैयारी होती है। जन्म विवरण और निजी नोट सूचना के ईमेल में नहीं भेजे जाते।'),
        t('A complete privacy notice, business identity, support contact, retention periods, and payment-provider information will be published before live bookings begin.',
          'असली बुकिंग शुरू होने से पहले पूरी गोपनीयता नीति, व्यवसाय और सहायता संपर्क का विवरण, जानकारी रखने की अवधि और भुगतान सेवा की जानकारी दी जाएगी।'),
      ],
    } : {
      title: t('Booking terms', 'बुकिंग की शर्तें'),
      body: [
        t('Appointments are confirmed only after verified captured payment. A slot is held temporarily during checkout. Payments received after the hold expires trigger a full refund request. Test bookings do not reserve a real consultation.',
          'भुगतान मिलने और जाँच के बाद ही परामर्श तय होता है। भुगतान के दौरान समय कुछ देर आरक्षित रहता है। समय समाप्त होने के बाद मिली राशि के लिए पूरा रिफ़ंड माँगा जाता है। परीक्षण बुकिंग से असली परामर्श आरक्षित नहीं होता।'),
        t('Before accepting real bookings, Vedā will publish confirmed service details, the cancellation and refund policy, and customer support contact information.',
          'असली बुकिंग लेने से पहले सेवाओं का पक्का विवरण, रद्द करने और रिफ़ंड की नीति और सहायता संपर्क प्रकाशित किए जाएँगे।'),
        t('Astrology is a traditional interpretive practice. Consultations are for reflection and do not promise outcomes.',
          'ज्योतिष व्याख्या की एक पारंपरिक विधि है। परामर्श का उद्देश्य मनन करना है। किसी नतीजे का वादा नहीं किया जाता।'),
      ],
    });
  }

  return (
    <>
      <a className="skip-link" href="#main">{t('Skip to content', 'मुख्य सामग्री पर जाएँ')}</a>
      <div className="hero-shell" id="home">
        <header className="header wrap">
          <a className="brand" href="#home" aria-label={t('Vedā home', 'वेदा का मुख्य पृष्ठ')}>
            <Sun /><span lang="en">vedā</span>
          </a>
          <nav id="main-nav" className={menu ? 'nav open' : 'nav'} aria-label={t('Main navigation', 'मुख्य नेविगेशन')}>
            {navItems.map(([title, id]) => (
              <a key={id} href={'#' + id} onClick={() => setMenu(false)}>{title}</a>
            ))}
          </nav>
          <div className="header-controls">
            <div className="language-switch" role="group" aria-label={t('Website language', 'वेबसाइट की भाषा')}>
              <button type="button" lang="en" aria-label="English" aria-pressed={!isHindi} onClick={() => chooseLanguage('en')}>EN</button>
              <button type="button" lang="hi" aria-pressed={isHindi} onClick={() => chooseLanguage('hi')}>हिन्दी</button>
            </div>
            <button className="button dark nav-book" onClick={() => setBooking(0)}>{t('Book a consultation', 'परामर्श बुक करें')} <Arrow /></button>
            <button className="menu-button" onClick={() => setMenu(!menu)} aria-expanded={menu} aria-controls="main-nav">
              {menu ? t('Close', 'बंद करें') : t('Menu', 'मेनू')} <span aria-hidden="true">{menu ? '−' : '+'}</span>
            </button>
          </div>
        </header>
        <main id="main">
          <BirthAtlasHero language={language} onBook={() => setBooking(0)} />
        </main>
      </div>

      <section className="about section wrap" id="about">
        <div className="section-label">01 / {t('OUR PHILOSOPHY', 'हमारा नज़रिया')}</div>
        <div className="about-grid">
          <div className="about-art">
            <span className="art-caption">{t('AN ANCIENT LENS. A PRESENT-DAY PERSPECTIVE.', 'प्राचीन परंपरा, आज का नज़रिया')}</span>
            <TempleArt language={language} />
            <span className="art-foot">{t('INSPIRED BY INDIA’S ASTRONOMICAL HERITAGE', 'भारत की खगोलीय विरासत से प्रेरित')}</span>
          </div>
          <div className="about-copy">
            <span className="eyebrow muted">{t('LESS CERTAINTY. MORE UNDERSTANDING.', 'समझने के लिए एक बातचीत')}</span>
            <h2>{t('Rooted in tradition.', 'परंपरा से जुड़ाव।')}<br /><em>{t('Guided by insight.', 'समझ से दिशा।')}</em></h2>
            <p>{t('Some questions deserve more than a quick answer. They deserve time, attention, and a different way of looking.', 'कुछ सवालों के लिए तुरंत जवाब से ज़्यादा समय, ध्यान और नए नज़रिए की ज़रूरत होती है।')}</p>
            <p>{t('At Vedā, we approach Jyotisha as a tradition of reflection. A way to explore your patterns, consider life’s seasons, and bring perspective to the decisions in front of you.', 'वेदा में हम ज्योतिष को मनन की परंपरा मानते हैं। इससे आप अपने अनुभवों, जीवन के बदलते दौर और सामने खड़े फैसलों को नए नज़रिए से देख सकते हैं।')}</p>
            <p className="about-emphasis">{t('Just a thoughtful conversation about you.', 'आपके सवालों पर एक सहज, विचारपूर्ण बातचीत।')}</p>
            <a className="text-link" href="#experience">{t('What to expect from a reading', 'परामर्श कैसे होता है')} <Arrow /></a>
          </div>
        </div>
      </section>

      <section className="services section wrap" id="services">
        <div className="section-label">02 / {t('CONSULTATIONS', 'परामर्श')}</div>
        <div className="section-heading">
          <h2>{t('What’s on', 'आपके मन में')}<br /><em>{t('your mind?', 'क्या है?')}</em></h2>
          <div>
            <p>{t('Big turning points. Small uncertainties.', 'जीवन के बड़े मोड़ या छोटी उलझनें।')}<br />{t('Start with the question that brought you here.', 'जिस सवाल ने आपको यहाँ तक पहुँचाया, उससे शुरू करें।')}</p>
            <span className="small-note">{t('ONE-TO-ONE · ONLINE · ₹200–₹500', 'व्यक्तिगत · ऑनलाइन · ₹200–₹500')}</span>
          </div>
        </div>
        <div className="service-list">
          {serviceList.slice(0, allServices ? 8 : 4).map((service, index) => (
            <button className="service-row" key={service.name} onClick={() => setBooking(index)}
              aria-label={t('Book ' + service.name + ', ' + service.duration + ' minutes, ' + service.price + ' rupees',
                service.name + ' बुक करें, ' + service.duration + ' मिनट, ' + service.price + ' रुपये')}>
              <span className="service-number">{String(index + 1).padStart(2, '0')}</span>
              <div className="service-name"><h3>{service.name}</h3><p>{service.subtitle}</p></div>
              <span className="service-duration">{service.duration} {t('min', 'मिनट')}</span>
              <span className="service-price">₹{service.price}</span>
              <span className="round-arrow"><Arrow /></span>
            </button>
          ))}
        </div>
        <div className="services-foot">
          <span>{t('Personal consultations · Secure checkout', 'व्यक्तिगत परामर्श · सुरक्षित भुगतान')}</span>
          <button className="text-link" aria-expanded={allServices} onClick={() => setAllServices(!allServices)}>
            {allServices ? t('Show fewer consultations', 'कम परामर्श दिखाएँ') : t('Explore all 8 consultations', 'सभी 8 परामर्श देखें')} <span aria-hidden="true">{allServices ? '−' : '+'}</span>
          </button>
        </div>
      </section>

      <section className="experience" id="experience">
        <div className="wrap">
          <div className="section-label">03 / {t('A SPACE FOR YOU', 'परामर्श कैसे होता है')}</div>
          <div className="experience-top">
            <h2>{t('A conversation.', 'एक बातचीत।')}<br /><em>{t('A fresh perspective.', 'एक नया नज़रिया।')}</em></h2>
            <p>{t('You don’t need to know your chart or have the perfect question. Just come as you are. We’ll take it one step at a time.', 'कुंडली की जानकारी होना ज़रूरी नहीं है। बस अपना सवाल लेकर आएँ। बातचीत धीरे-धीरे आगे बढ़ेगी।')}</p>
          </div>
          <div className="steps">
            {steps.map(([title, body], index) => (
              <div key={title}><span className="step-number">0{index + 1}</span><h3>{title}</h3><p>{body}</p></div>
            ))}
          </div>
          <button className="button lime" onClick={() => setBooking(7)}>{t('Let’s begin', 'शुरू करें')} <Arrow /></button>
        </div>
      </section>

      <section className="rashi-section section wrap" id="rashis">
        <div className="section-label">04 / {t('A LANGUAGE OF THE SKY', 'आकाश की भाषा')}</div>
        <div className="rashi-intro">
          <h2>{t('Twelve Rashis.', 'बारह राशियाँ।')}<br /><em>{t('Many ways of being.', 'स्वभाव के कई रूप।')}</em></h2>
          <p>{t('A small introduction to the sidereal zodiac used in Vedic astrology. Explore its twelve signs and their traditional associations.', 'वैदिक ज्योतिष में प्रयुक्त निरयन राशि चक्र का संक्षिप्त परिचय। बारह राशियों और उनसे जुड़ी परंपरागत मान्यताओं को जानें।')}</p>
        </div>
        <div className="rashi-explorer">
          <div className="rashi-selector" role="group" aria-label={t('Choose a Rashi', 'राशि चुनें')}>
            {rashiList.map(([name, devanagari], index) => (
              <button key={name} aria-pressed={index === rashi} onClick={() => setRashi(index)}>
                <span className="rashi-num">{String(index + 1).padStart(2, '0')}</span>
                <span lang={isHindi ? 'hi' : 'en'}>{isHindi ? devanagari : name}</span>
                {!isHindi && <span className="rashi-dev" lang="sa">{devanagari}</span>}
              </button>
            ))}
          </div>
          <div className="rashi-detail" aria-live="polite">
            <div className="rashi-detail-top">
              <span>{t('RASHI', 'राशि')} {String(rashi + 1).padStart(2, '0')}</span><span>{rashi * 30}° — {(rashi + 1) * 30}°</span>
            </div>
            <div className="rashi-sanskrit" lang="sa">{current[1]}</div>
            <h3>{isHindi ? current[1] : current[0]} <span>/ {current[2]}</span></h3>
            <p className="rashi-meaning">{current[5]}</p>
            <div className="rashi-properties">
              <div><span>{t('ELEMENT', 'तत्व')}</span><strong>{current[3]}</strong></div>
              <div><span>{t('TRADITIONAL RULER', 'स्वामी ग्रह')}</span><strong>{current[4]}</strong></div>
            </div>
            <p className="rashi-disclaimer">{t('These symbolic associations describe one part of a much larger chart.', 'ये प्रतीकात्मक संबंध पूरी कुंडली का एक छोटा हिस्सा हैं।')}</p>
          </div>
        </div>
        <p className="rashi-source">
          {t('A Rashi is a 30° division of the zodiac.', 'राशि, राशि चक्र का 30° का एक भाग है।')}{' '}
          <a href="https://www.drikpanchang.com/astrology/prediction/info/find-rashi-with-name.html"
            target="_blank" rel="noreferrer">{t('Rashi reference ↗', 'राशि संदर्भ (अंग्रेज़ी) ↗')}</a>
        </p>
      </section>

      <section className="journal section wrap" id="journal">
        <div className="section-label">05 / {t('THE JOURNAL', 'लेख')}</div>
        <div className="section-heading">
          <h2>{t('A little knowledge.', 'थोड़ी जानकारी।')}<br /><em>{t('A wider perspective.', 'एक व्यापक नज़रिया।')}</em></h2>
          <p>{t('Notes on the sky, the self, and the space in between.', 'आकाश, अपने स्वभाव और दोनों के संबंध पर कुछ विचार।')}</p>
        </div>
        <div className="journal-grid">
          {journal.map((article, index) => (
            <button key={article.slug} className="journal-item" onClick={() => setContent(article)}>
              <div className={'journal-art journal-art-' + index}><JournalArt index={index} language={language} /><span className="journal-arrow"><Arrow /></span></div>
              <div className="journal-meta"><span>{article.category}</span><span>{article.time}</span></div>
              <h3>{article.title}</h3>
              <span className="journal-read">{t('Read the story', 'लेख पढ़ें')} <Arrow /></span>
            </button>
          ))}
        </div>
      </section>

      <section className="faq section wrap" id="faq">
        <div><div className="section-label">06 / {t('GOOD TO KNOW', 'ज़रूरी जानकारी')}</div><h2>{t('A few things', 'अक्सर पूछे')}<br /><em>{t('you might wonder.', 'जाने वाले सवाल।')}</em></h2></div>
        <div className="faq-list">
          {faqs.map(([question, answer]) => (
            <details key={question}><summary>{question}<span aria-hidden="true">+</span></summary><p>{answer}</p></details>
          ))}
        </div>
      </section>

      <section className="final-cta">
        <div className="wrap">
          <Sun />
          <span className="eyebrow">{t('YOUR NEXT CHAPTER STARTS WITH A CONVERSATION.', 'एक बातचीत से नई शुरुआत।')}</span>
          <h2>{t('A little clarity can', 'थोड़ी समझ से')}<br /><em>{t('change your perspective.', 'नज़रिया बदल सकता है।')}</em></h2>
          <button className="button lime" onClick={() => setBooking(0)}>{t('Book a consultation', 'परामर्श बुक करें')} <Arrow /></button>
          <p>{t('Make a little space for yourself.', 'अपने लिए थोड़ा समय निकालें।')}</p>
        </div>
      </section>

      <footer className="footer wrap">
        <div className="footer-top">
          <div>
            <a className="brand footer-brand" href="#home"><Sun /><span lang="en">vedā</span></a>
            <p>{t('Ancient wisdom.', 'प्राचीन ज्ञान।')}<br />{t('For the life you’re living.', 'आज के जीवन के लिए।')}</p>
          </div>
          <div className="footer-links">
            {navItems.filter(([, id]) => id !== 'rashis').map(([title, id]) => <a key={id} href={'#' + id}>{title}</a>)}
            <a href="#faq">{t('FAQs & support', 'सवाल और सहायता')}</a>
          </div>
          <div className="footer-message">
            <span className="eyebrow">{t('A NOTE FROM VEDĀ', 'वेदा की ओर से')}</span>
            <p>{t('The sky offers perspective.', 'आकाश एक नज़रिया देता है।')}<br />{t('The path is always yours.', 'राह आप चुनते हैं।')}</p>
            <span lang="sa">ज्योतिष</span>
          </div>
        </div>
        <div className="footer-bottom">
          <span>© {new Date().getFullYear()} {t('Vedā', 'वेदा')}</span>
          <div>
            <button onClick={() => showPolicy('privacy')}>{t('Privacy', 'गोपनीयता')}</button>
            <button onClick={() => showPolicy('terms')}>{t('Terms & cancellations', 'शर्तें और रद्दीकरण')}</button>
          </div>
        </div>
      </footer>

      {booking !== null && <Booking language={language} initialService={booking} onClose={() => setBooking(null)} />}
      {content && <ContentDialog language={language} content={content} onClose={() => setContent(null)} />}
    </>
  );
}
