'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { services } from '@/lib/content';
import { hindiServices } from '@/lib/hindi-content';
import { localeFor, translate, type Language } from '@/lib/language';
import { Sun } from './artwork';
import { api, ApiError, newAccessToken, loadRazorpay, serviceIds, type BookingConfig, type BookingStatus, type CheckoutOrder } from '@/lib/booking-api';

function indiaToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function bookingSchema(language: Language) {
  const t = translate(language);
  return z.object({
    name: z.string().trim().min(2, t('Please enter your name.', 'कृपया अपना नाम लिखें।'))
      .max(100, t('Use 100 characters or fewer.', '100 या कम अक्षर लिखें।')),
    email: z.string().trim().email(t('Please enter a valid email address.', 'कृपया सही ईमेल पता लिखें।')),
    dob: z.string().optional(),
    tob: z.string().optional(),
    place: z.string().trim().max(150, t('Use 150 characters or fewer.', '150 या कम अक्षर लिखें।')).optional(),
    unknown: z.boolean().optional(),
    notes: z.string().max(1000, t('Please keep your note under 1,000 characters.', 'अपना सवाल 1,000 अक्षरों के भीतर लिखें।')).optional(),
    consent: z.boolean().refine((value) => value, t('Please agree to the booking terms and privacy notice.', 'कृपया बुकिंग की शर्तें और गोपनीयता सूचना स्वीकार करें।')),
  });
}

type Details = z.infer<ReturnType<typeof bookingSchema>>;
const recoveryKey = 'veda-checkout';

export function Booking({ language, initialService, onClose }: {
  language: Language;
  initialService: number;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [step, setStep] = useState(0);
  const [serviceId, setServiceId] = useState(initialService);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [monthOffset, setMonthOffset] = useState(0);
  const [config, setConfig] = useState<BookingConfig | null>(null);
  const [slots, setSlots] = useState<{ time: string; available: boolean }[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [receipt, setReceipt] = useState<BookingStatus | null>(null);
  const [checkout, setCheckout] = useState<CheckoutOrder | null>(null);
  const [recovery, setRecovery] = useState<{ id: string; token: string } | null>(null);
  const accessToken = useRef('');
  const orderGuard = useRef(false);
  const status = receipt?.status === 'confirmed' && receipt.paymentStatus === 'captured' ? 'success' : 'idle';
  const reference = receipt?.id ?? '';

  const t = translate(language);
  const locale = localeFor(language);
  const serviceList = (language === 'hi' ? hindiServices : services).map((item, index) => {
    const authoritative = config?.services.find(s => s.id === serviceIds[index]);
    return authoritative ? { ...item, price: authoritative.amount / 100, duration: authoritative.duration } : item;
  });
  const service = serviceList[serviceId];
  const schema = useMemo(() => bookingSchema(language), [language]);
  const form = useForm<Details>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', email: '', dob: '', tob: '', place: '', unknown: false, notes: '', consent: false },
  });
  const { errors } = form.formState;
  const unknown = form.watch('unknown');
  const today = indiaToday();
  const base = new Date(today + 'T12:00:00+05:30');
  const month = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + monthOffset, 1));
  const year = month.getUTCFullYear();
  const monthIndex = month.getUTCMonth();
  const dayCount = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const monthName = month.toLocaleDateString(locale, { timeZone: 'UTC', month: 'long', year: 'numeric' });
  const days = Array.from({ length: dayCount }, (_, index) =>
    [year, String(monthIndex + 1).padStart(2, '0'), String(index + 1).padStart(2, '0')].join('-'));
  const weekdays = language === 'hi'
    ? ['रवि', 'सोम', 'मंगल', 'बुध', 'गुरु', 'शुक्र', 'शनि']
    : ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  const isUnavailable = (day: string) => !config || day <= today ||
    !config.schedule.days.includes(new Date(day + 'T12:00:00Z').getUTCDay()) ||
    new Date(day + 'T00:00:00Z').getTime() > new Date(today + 'T00:00:00Z').getTime() + config.schedule.daysAhead * 86400000;
  const money = (value: number) => new Intl.NumberFormat(locale, {
    style: 'currency', currency: 'INR', maximumFractionDigits: 0,
  }).format(value);
  const readableDate = (day: string) => new Date(day + 'T12:00:00+05:30').toLocaleDateString(locale, {
    timeZone: 'Asia/Kolkata', day: 'numeric', month: 'long', year: 'numeric',
  });
  const durationLabel = (duration: number) => duration + ' ' + t('min', 'मिनट') + ' · ' + t('Online', 'ऑनलाइन');

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
      opener?.focus();
    };
  }, []);

  useEffect(() => {
    if (step > 0) {
      heading.current?.focus({ preventScroll: true });
      dialog.current?.scrollTo({ top: 0 });
    }
  }, [step, status]);

  useEffect(() => {
    const controller = new AbortController();
    api<BookingConfig>('/booking/config', { signal: controller.signal }).then(setConfig).catch(() => {
      if (!controller.signal.aborted) setProblem(t('Booking is temporarily unavailable. Please try again shortly.', 'बुकिंग अभी उपलब्ध नहीं है। कृपया थोड़ी देर बाद कोशिश करें।'));
    });
    try {
      const saved = JSON.parse(sessionStorage.getItem(recoveryKey) || 'null');
      if (saved && typeof saved.id === 'string' && /^[a-f0-9]{64}$/.test(saved.token)) {
        setRecovery(saved); accessToken.current = saved.token;
      }
    } catch { /* Recovery remains available during this visit. */ }
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!date || !config) return;
    const controller = new AbortController();
    setLoadingSlots(true); setSlots([]); setProblem('');
    api<{ slots: { time: string; available: boolean }[] }>('/availability?date=' + date, { signal: controller.signal })
      .then(result => setSlots(result.slots))
      .catch(() => { if (!controller.signal.aborted) setProblem(t('Could not load availability. Choose the date again.', 'उपलब्ध समय नहीं मिले। तारीख फिर चुनें।')); })
      .finally(() => { if (!controller.signal.aborted) setLoadingSlots(false); });
    return () => controller.abort();
  }, [date, config]);

  useEffect(() => {
    if (!recovery) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await api<BookingStatus>('/bookings/' + recovery.id, { headers: { Authorization: 'Bearer ' + recovery.token }, signal: controller.signal });
        setReceipt(result);
        if (result.status !== 'pending') setBusy(false);
        if (result.status === 'pending' || result.paymentStatus === 'refund_pending') timer = setTimeout(poll, 4000);
      } catch { if (!controller.signal.aborted) timer = setTimeout(poll, 8000); }
    };
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [recovery]);

  function nextFromDetails(values: Details) {
    if (service.birth) {
      let invalid = false;
      if (!values.dob || values.dob > today || values.dob < '1900-01-01') {
        form.setError('dob', { message: t('Enter a valid birth date in the past.', 'बीती हुई कोई सही जन्मतिथि चुनें।') });
        invalid = true;
      }
      if (!values.unknown && !values.tob) {
        form.setError('tob', { message: t('Enter a birth time or select “I don’t know”.', 'जन्म समय लिखें या “मुझे अपना जन्म समय नहीं पता” चुनें।') });
        invalid = true;
      }
      if (!values.place || values.place.length < 2) {
        form.setError('place', { message: t('Please enter your birth city.', 'कृपया अपने जन्म का शहर लिखें।') });
        invalid = true;
      }
      if (invalid) return;
    }
    setStep(3);
  }

  function resetCheckout() {
    setRecovery(null); setReceipt(null); setCheckout(null); setProblem(''); setTime(''); setDate(''); setStep(1);
    accessToken.current = ''; orderGuard.current = false;
    try { sessionStorage.removeItem(recoveryKey); } catch { /* Optional recovery storage. */ }
  }

  async function pay() {
    if (orderGuard.current || !config?.enabled) return;
    orderGuard.current = true; setBusy(true); setProblem('');
    try {
      await loadRazorpay();
      if (!accessToken.current) accessToken.current = newAccessToken();
      const order = checkout ?? await api<CheckoutOrder>('/bookings', {
        method: 'POST', headers: { 'Idempotency-Key': accessToken.current },
        body: JSON.stringify({ ...form.getValues(), serviceId: serviceIds[serviceId], date, time, language }),
      });
      setCheckout(order);
      const saved = { id: order.id, token: accessToken.current };
      setRecovery(saved);
      try { sessionStorage.setItem(recoveryKey, JSON.stringify(saved)); } catch { /* Browser storage may be disabled. */ }
      const remaining = Math.floor((+new Date(order.holdUntil) - Date.now()) / 1000);
      if (remaining <= 0) throw new Error(t('This checkout has expired. Check its status below.', 'इस भुगतान का समय समाप्त हो गया है। नीचे स्थिति देखें।'));
      const restore = () => { if (dialog.current?.isConnected && !dialog.current.open) dialog.current.showModal(); setBusy(false); orderGuard.current = false; };
      const razorpay = new window.Razorpay!({
        key: order.keyId, amount: order.amount, currency: order.currency, order_id: order.orderId,
        name: 'Vedā', description: service.name, prefill: { name: form.getValues('name'), email: form.getValues('email') },
        theme: { color: '#171c15' }, timeout: remaining,
        handler: async result => {
          restore(); setBusy(true);
          try {
            const verified = await api<BookingStatus>('/bookings/' + order.id + '/verify', { method: 'POST',
              headers: { Authorization: 'Bearer ' + saved.token },
              body: JSON.stringify({ paymentId: result.razorpay_payment_id, signature: result.razorpay_signature }) });
            setReceipt(verified);
          } catch { setProblem(t('We are checking your payment. Do not pay again. Confirmation will update here and by email.', 'हम आपके भुगतान की जाँच कर रहे हैं। दोबारा भुगतान न करें। पुष्टि यहाँ और ईमेल में मिलेगी।')); }
          finally { setBusy(false); }
        },
        modal: { ondismiss: () => { restore(); setProblem(t('Checkout closed. Payment status is checked below. If money was debited, wait for confirmation before retrying.', 'भुगतान विंडो बंद हुई। नीचे स्थिति देखें। राशि कटी हो तो फिर भुगतान करने से पहले पुष्टि की प्रतीक्षा करें।')); } },
      });
      // Razorpay mounts outside the native dialog's top layer.
      dialog.current?.close();
      razorpay.open();
    } catch (error) {
      if (dialog.current?.isConnected && !dialog.current.open) dialog.current.showModal();
      setProblem(language === 'hi' && error instanceof ApiError ? 'भुगतान शुरू नहीं हो सका। ' + (error.code === 'SLOT_TAKEN' ? 'कृपया दूसरा समय चुनें।' : 'कुछ देर बाद फिर कोशिश करें।') : error instanceof Error ? error.message : t('Please try again.', 'कृपया फिर कोशिश करें।'));
      setBusy(false); orderGuard.current = false;
      if (error instanceof ApiError && error.code === 'SLOT_TAKEN') { accessToken.current = ''; setTime(''); setStep(1); }
    }
  }

  function downloadCalendar() {
    if (!receipt) return;
    const start = new Date(receipt.startsAt);
    const end = new Date(start.getTime() + receipt.duration * 60000);
    const format = (value: Date) => value.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const event = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Veda//Appointments//EN', 'BEGIN:VEVENT',
      'UID:' + reference + '@veda', 'DTSTAMP:' + format(new Date()),
      'DTSTART:' + format(start), 'DTEND:' + format(end),
      'SUMMARY:' + (receipt.mode === 'test' ? 'TEST - ' : '') + receipt.service.replace(/[,;\\\n]/g, ' '),
      'DESCRIPTION:Joining instructions are sent by email.',
      'STATUS:' + (receipt.mode === 'test' ? 'TENTATIVE' : 'CONFIRMED'), 'END:VEVENT', 'END:VCALENDAR', '',
    ].join('\r\n');
    const url = URL.createObjectURL(new Blob([event], { type: 'text/calendar;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'veda-appointment.ics';
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const error = (field: keyof Details) => errors[field]?.message
    ? <span id={field + '-error'} className="field-error" role="alert">{errors[field]?.message}</span>
    : null;

  const progress = [t('Consultation', 'परामर्श'), t('Date & time', 'दिन और समय'), t('Your details', 'आपकी जानकारी'), t('Review', 'समीक्षा')];

  return (
    <dialog ref={dialog} className="booking-dialog" aria-labelledby="booking-title" onCancel={event => { if (busy) event.preventDefault(); else onClose(); }}>
      <div className="booking-layout">
        <aside className="booking-aside">
          <a className="brand" href="#home" onClick={onClose}><Sun /><span lang="en">vedā</span></a>
          <div>
            <span className="eyebrow">{t('MAKE A LITTLE SPACE.', 'अपने लिए समय निकालें।')}</span>
            <h2>{t('Your questions.', 'आपके सवाल।')}<br />{t('Your time.', 'आपका समय।')}<br /><em>{t('Your perspective.', 'आपका नज़रिया।')}</em></h2>
          </div>
          <div className="booking-summary">
            <span className="eyebrow">{t('YOUR CONSULTATION', 'आपका परामर्श')}</span>
            <h3>{receipt?.service ?? service.name}</h3>
            <p>{durationLabel(receipt?.duration ?? service.duration)}</p>
            {receipt ? <p>{new Date(receipt.startsAt).toLocaleString(locale, { timeZone: 'Asia/Kolkata' })} IST</p> : date && <p>{readableDate(date)}{time && ' · ' + time + ' IST'}</p>}
            <strong>{money(receipt ? receipt.amount / 100 : service.price)}</strong>
            <span className="small-note">{t('SECURE CHECKOUT · RAZORPAY', 'सुरक्षित भुगतान · RAZORPAY')}</span>
          </div>
          <p className="aside-note">{t('A personal conversation.', 'एक व्यक्तिगत बातचीत।')}<br />{t('A thoughtful beginning.', 'सोच-समझकर एक शुरुआत।')}</p>
        </aside>

        <div className="booking-main">
          <div className="booking-toolbar">
            <button className="close-button" disabled={busy} onClick={onClose} aria-label={t('Close booking', 'बुकिंग बंद करें')}>×</button>
            <div className="preview-notice">
              {config?.mode === 'live' ? t('YOUR CONSULTATION', 'आपका परामर्श') : t('TEST MODE', 'परीक्षण मोड')} <span>{config?.enabled ? (config.mode === 'live' ? t('Confirmation follows verified payment.', 'भुगतान की जाँच के बाद पुष्टि मिलेगी।') : t('Use test payment details. No real consultation is reserved.', 'परीक्षण भुगतान विवरण दें। असली परामर्श बुक नहीं होगा।')) : t('Online booking is not open yet.', 'ऑनलाइन बुकिंग अभी शुरू नहीं हुई है।')}</span>
            </div>
          </div>

          {problem && <p className="payment-status" role="alert">{problem}</p>}

          {status !== 'success' && !recovery && (
            <ol className="booking-progress" aria-label={t('Booking progress', 'बुकिंग के चरण')}>
              {progress.map((label, index) => (
                <li key={label} className={step === index ? 'active' : step > index ? 'complete' : ''}
                  aria-current={step === index ? 'step' : undefined}>
                  <span>{index + 1}</span>{label}
                </li>
              ))}
            </ol>
          )}
          {step > 0 && status !== 'success' && !recovery && (
            <div className="booking-mobile-summary"><span>{service.name}</span><strong>{money(service.price)}</strong></div>
          )}

          {status === 'success' ? (
            <div className="confirmation">
              <Sun />
              <span className="eyebrow">{receipt?.mode === 'test' ? t('TEST BOOKING CONFIRMED', 'परीक्षण बुकिंग की पुष्टि') : t('YOUR CONSULTATION IS CONFIRMED', 'आपके परामर्श की पुष्टि हो गई')}</span>
              <h2 id="booking-title" ref={heading} tabIndex={-1}>{t('A little clarity,', 'आपका परामर्श')}<br /><em>{t('on your calendar.', 'तय हो गया।')}</em></h2>
              <p>{receipt?.mode === 'test' ? t('Test payment verified. This is not a real consultation reservation.', 'परीक्षण भुगतान की जाँच पूरी हुई। यह असली परामर्श की बुकिंग नहीं है।') : t('Your payment is verified and your appointment is reserved.', 'भुगतान की पुष्टि हो गई है और आपका समय आरक्षित है।')}</p>
              <dl className="receipt">
                <div><dt>{t('Reference', 'क्रमांक')}</dt><dd>{reference}</dd></div>
                <div><dt>{t('Consultation', 'परामर्श')}</dt><dd>{receipt?.service}</dd></div>
                <div><dt>{t('When', 'दिन और समय')}</dt><dd>{receipt && new Date(receipt.startsAt).toLocaleString(locale, { timeZone: 'Asia/Kolkata', dateStyle: 'long', timeStyle: 'short' })} IST</dd></div>
                <div><dt>{t('Duration', 'अवधि')}</dt><dd>{receipt?.duration} {t('minutes', 'मिनट')}</dd></div>
                <div><dt>{t('Amount', 'राशि')}</dt><dd>{money((receipt?.amount ?? 0) / 100)}{receipt?.mode === 'test' && ' · ' + t('Test payment', 'परीक्षण भुगतान')}</dd></div>
              </dl>
              <p className="small-copy">{t('Your confirmation email has been queued. Joining instructions will follow by email.', 'पुष्टि का ईमेल भेजने की प्रक्रिया शुरू हो गई है। जुड़ने का विवरण ईमेल से मिलेगा।')}</p>
              <button className="button dark full" onClick={downloadCalendar}>{t('Add to calendar', 'कैलेंडर में जोड़ें')} <span aria-hidden="true">↓</span></button>
              <div className="confirmation-actions">
                {config?.supportEmail && <a className="text-link" href={'mailto:' + config.supportEmail}>{t('Contact support', 'सहायता से संपर्क करें')}</a>}
                <button className="text-link" onClick={() => { resetCheckout(); onClose(); }}>{t('Done', 'पूरा हुआ')} ↗</button>
              </div>
            </div>
          ) : recovery ? (
            <div className="confirmation">
              <span className="eyebrow">{t('PAYMENT STATUS', 'भुगतान की स्थिति')}</span>
              <h2 id="booking-title" ref={heading} tabIndex={-1}>{receipt?.status === 'cancelled' ? t('Refund update', 'रिफ़ंड की जानकारी') : t('Checking your booking', 'बुकिंग की जाँच हो रही है')}</h2>
              <p>{receipt?.status === 'expired' ? t('Your slot hold has expired. Any payment captured after expiry will be refunded automatically.', 'आपके समय का आरक्षण समाप्त हो गया। इसके बाद मिले भुगतान का रिफ़ंड अपने आप किया जाएगा।') : receipt?.status === 'cancelled' ? t('This appointment is cancelled. The refund status is shown below.', 'यह परामर्श रद्द हो गया है। रिफ़ंड की स्थिति नीचे है।') : t('Please wait for payment verification. If money was debited, do not pay again.', 'भुगतान की जाँच की प्रतीक्षा करें। राशि कटी हो तो दोबारा भुगतान न करें।')}</p>
              <dl className="receipt"><div><dt>{t('Reference', 'क्रमांक')}</dt><dd>{recovery.id}</dd></div><div><dt>{t('Payment', 'भुगतान')}</dt><dd>{receipt?.paymentStatus === 'refunded' ? t('Refund processed', 'रिफ़ंड जारी हुआ') : receipt?.paymentStatus === 'refund_pending' ? t('Refund pending', 'रिफ़ंड लंबित है') : receipt?.paymentStatus === 'refund_failed' ? t('Refund needs assistance', 'रिफ़ंड के लिए सहायता चाहिए') : t('Awaiting confirmation', 'पुष्टि की प्रतीक्षा')}</dd></div></dl>
              {receipt?.status === 'pending' && checkout && <button className="button dark full" disabled={busy} onClick={pay}>{t('Resume this checkout', 'इसी भुगतान को जारी रखें')}</button>}
              {receipt && ['expired','cancelled'].includes(receipt.status) && <button className="button dark full" onClick={resetCheckout}>{t('Choose a new time', 'नया समय चुनें')}</button>}
              {config?.supportEmail && <a className="text-link" href={'mailto:' + config.supportEmail}>{t('Contact support', 'सहायता से संपर्क करें')}</a>}
            </div>
          ) : (
            <>
              {step === 0 && (
                <>
                  <span className="eyebrow muted">{t('STEP 01 / FIND YOUR FOCUS', 'चरण 01 / अपना विषय चुनें')}</span>
                  <h2 id="booking-title" ref={heading} tabIndex={-1}>{t('What brings', 'किस विषय पर')} <em>{t('you here?', 'बात करना चाहेंगे?')}</em></h2>
                  <p className="booking-description">{t('Choose the conversation you’d like to have.', 'अपने सवाल से जुड़ा परामर्श चुनें।')}</p>
                  <div className="booking-services" role="group" aria-label={t('Select consultation', 'परामर्श चुनें')}>
                    {serviceList.map((item, index) => (
                      <button key={item.name} aria-pressed={serviceId === index}
                        onClick={() => { setServiceId(index); form.clearErrors(); }}>
                        <span><strong>{item.name}</strong><small>{durationLabel(item.duration)}</small></span>
                        <span>{money(item.price)} <span className="radio-dot" aria-hidden="true" /></span>
                      </button>
                    ))}
                  </div>
                  <div className="booking-next">
                    <button className="button dark full" disabled={!config?.enabled} onClick={() => setStep(1)}>{config?.enabled ? t('Choose a time', 'समय चुनें') : t('Booking opens soon', 'बुकिंग जल्द शुरू होगी')} <span aria-hidden="true">→</span></button>
                  </div>
                </>
              )}

              {step === 1 && (
                <>
                  <span className="eyebrow muted">{t('STEP 02 / A MOMENT FOR YOURSELF', 'चरण 02 / अपने लिए समय')}</span>
                  <h2 id="booking-title" ref={heading} tabIndex={-1}>{t('Make a little', 'दिन और समय')} <em>{t('time.', 'चुनें।')}</em></h2>
                  <p className="booking-description">{t('All times are in Asia/Kolkata (IST, UTC+05:30).', 'सभी समय भारतीय मानक समय (IST, UTC+05:30) में हैं।')}</p>
                  <div className="calendar">
                    <div className="calendar-header">
                      <h3>{monthName}</h3>
                      <div>
                        <button aria-label={t('Previous month', 'पिछला महीना')} disabled={monthOffset === 0} onClick={() => setMonthOffset(monthOffset - 1)}>←</button>
                        <button aria-label={t('Next month', 'अगला महीना')} disabled={monthOffset === 2} onClick={() => setMonthOffset(monthOffset + 1)}>→</button>
                      </div>
                    </div>
                    <div className="calendar-grid">
                      {weekdays.map((weekday) => <span className="weekday" key={weekday}>{weekday}</span>)}
                      {Array.from({ length: month.getUTCDay() }, (_, index) => <span key={'blank-' + index} />)}
                      {days.map((day, index) => (
                        <button key={day} disabled={isUnavailable(day)} aria-label={readableDate(day)}
                          aria-pressed={day === date} onClick={() => { setDate(day); setTime(''); }}>
                          {index + 1}
                        </button>
                      ))}
                    </div>
                    <p className="calendar-caption">{t('Available times update when you choose a date.', 'तारीख चुनने पर उपलब्ध समय दिखाई देंगे।')}</p>
                  </div>
                  {date && (
                    <div className="time-slots">
                      <h3>{loadingSlots ? t('Loading available times…', 'उपलब्ध समय देख रहे हैं…') : t('Available times for ' + readableDate(date), readableDate(date) + ' के उपलब्ध समय')}</h3>
                      <div>
                        {slots.map((slot) => (
                          <button key={slot.time} disabled={!slot.available} aria-pressed={time === slot.time} onClick={() => setTime(slot.time)}>
                            {slot.time}{!slot.available && <span>{t('Unavailable', 'उपलब्ध नहीं')}</span>}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="booking-actions">
                    <button className="text-link" onClick={() => setStep(0)}>← {t('Back', 'पीछे')}</button>
                    <button className="button dark" disabled={!date || !time} onClick={() => setStep(2)}>{t('Your details', 'अपनी जानकारी दें')} →</button>
                  </div>
                </>
              )}

              {step === 2 && (
                <>
                  <span className="eyebrow muted">{t('STEP 03 / A LITTLE ABOUT YOU', 'चरण 03 / आपके बारे में')}</span>
                  <h2 id="booking-title" ref={heading} tabIndex={-1}>{t('Every story', 'आपकी कहानी')} <em>{t('is personal.', 'आपकी अपनी है।')}</em></h2>
                  <p className="booking-description">{t('We store these details to arrange your consultation and email your confirmation.', 'परामर्श की तैयारी और पुष्टि का ईमेल भेजने के लिए यह जानकारी सहेजी जाएगी।')}</p>
                  <form noValidate onSubmit={form.handleSubmit(nextFromDetails)}>
                    <div className="form-fields">
                      <label>
                        {t('Your name', 'आपका नाम')}
                        <input {...form.register('name')} autoComplete="name" aria-invalid={!!errors.name}
                          aria-describedby={errors.name ? 'name-error' : undefined} placeholder={t('Your full name', 'अपना पूरा नाम लिखें')} />
                        {error('name')}
                      </label>
                      <label>
                        {t('Email address', 'ईमेल पता')}
                        <input {...form.register('email')} type="email" autoComplete="email" aria-invalid={!!errors.email}
                          aria-describedby={errors.email ? 'email-error' : undefined} placeholder="you@example.com" />
                        {error('email')}
                      </label>
                      {service.birth && (
                        <>
                          <div className="birth-note">{t('Your date, time, and place of birth help frame the birth chart. An uncertain time can limit the reading’s detail.', 'जन्मतिथि, समय और स्थान से कुंडली बनती है। समय पक्का न हो तो व्याख्या का विवरण सीमित हो सकता है।')}</div>
                          <div className="form-two">
                            <label>{t('Date of birth', 'जन्मतिथि')}
                              <input {...form.register('dob')} type="date" min="1900-01-01" max={today} aria-invalid={!!errors.dob}
                                aria-describedby={errors.dob ? 'dob-error' : undefined} />
                              {error('dob')}
                            </label>
                            <label>{t('Time of birth', 'जन्म समय')}
                              <input {...form.register('tob')} type="time" disabled={unknown} aria-invalid={!!errors.tob}
                                aria-describedby={errors.tob ? 'tob-error' : undefined} />
                              {error('tob')}
                            </label>
                          </div>
                          <label className="checkbox-label">
                            <input {...form.register('unknown', { onChange: () => form.clearErrors('tob') })} type="checkbox" />
                            {t('I don’t know my birth time', 'मुझे अपना जन्म समय नहीं पता')}
                          </label>
                          <label>{t('Place of birth', 'जन्म स्थान')}
                            <input {...form.register('place')} placeholder={t('City, state, country', 'शहर, राज्य, देश')}
                              aria-invalid={!!errors.place} aria-describedby={errors.place ? 'place-error' : undefined} />
                            {error('place')}
                          </label>
                        </>
                      )}
                      <label>
                        <span>{t('What’s on your mind?', 'आपके मन में क्या है?')} <span className="optional">{t('(optional)', '(वैकल्पिक)')}</span></span>
                        <textarea {...form.register('notes')} rows={3} placeholder={t('A question you’d like to explore…', 'जिस सवाल पर आप बात करना चाहते हैं…')} />
                        {error('notes')}
                      </label>
                      <label className="checkbox-label">
                        <input {...form.register('consent')} type="checkbox" aria-describedby={errors.consent ? 'consent-error' : undefined} />
                        {t('I agree to the booking terms and privacy notice, and to receive appointment emails.', 'मैं बुकिंग की शर्तें और गोपनीयता सूचना स्वीकार करता/करती हूँ और परामर्श के ईमेल पाने की सहमति देता/देती हूँ।')}
                      </label>
                      {error('consent')}
                      <p className="small-copy"><a href={config?.termsUrl || '/policies#terms'} target="_blank" rel="noreferrer">{t('Booking terms', 'बुकिंग की शर्तें')}</a> · <a href={config?.privacyUrl || '/policies#privacy'} target="_blank" rel="noreferrer">{t('Privacy notice', 'गोपनीयता सूचना')}</a></p>
                    </div>
                    <div className="booking-actions">
                      <button type="button" className="text-link" onClick={() => setStep(1)}>← {t('Back', 'पीछे')}</button>
                      <button className="button dark" type="submit">{t('Review consultation', 'परामर्श की समीक्षा करें')} →</button>
                    </div>
                  </form>
                </>
              )}

              {step === 3 && (
                <>
                  <span className="eyebrow muted">{t('STEP 04 / THE DETAILS, CLEARLY', 'चरण 04 / विवरण की समीक्षा')}</span>
                  <h2 id="booking-title" ref={heading} tabIndex={-1}>{t('A thoughtful', 'अपना परामर्श')} <em>{t('beginning.', 'एक बार देखें।')}</em></h2>
                  <p className="booking-description">{t('Review your consultation before secure checkout.', 'सुरक्षित भुगतान से पहले परामर्श का विवरण देख लें।')}</p>
                  <dl className="receipt">
                    <div><dt>{t('Consultation', 'परामर्श')}</dt><dd>{service.name}</dd></div>
                    <div><dt>{t('Date & time', 'दिन और समय')}</dt><dd>{readableDate(date)}<br />{time} · Asia/Kolkata</dd></div>
                    <div><dt>{t('Duration & mode', 'अवधि और माध्यम')}</dt><dd>{durationLabel(service.duration)}</dd></div>
                    <div><dt>{t('Name', 'नाम')}</dt><dd>{form.getValues('name')}</dd></div>
                    <div><dt>{t('Email', 'ईमेल')}</dt><dd>{form.getValues('email')}</dd></div>
                    <div><dt>{t('Base price', 'मूल शुल्क')}</dt><dd>{money(service.price)}</dd></div>
                    <div className="receipt-total"><dt>{t('Total', 'कुल शुल्क')}</dt><dd>{money(service.price)}</dd></div>
                  </dl>
                  <p className="small-copy">{t('Your time is held during checkout. The appointment is confirmed only after payment verification.', 'भुगतान के दौरान आपका समय कुछ देर आरक्षित रहेगा। भुगतान की जाँच के बाद ही परामर्श तय होगा।')}</p>
                  <div className="booking-actions">
                    <button className="text-link" disabled={busy} onClick={() => { accessToken.current = ''; setStep(2); }}>← {t('Edit details', 'जानकारी बदलें')}</button>
                    <button className="button dark" disabled={busy || !config?.enabled} onClick={pay}>
                      {busy ? t('Opening checkout…', 'भुगतान खुल रहा है…') : t('Pay securely', 'सुरक्षित भुगतान करें')} →
                    </button>
                  </div>
                  <p className="checkout-note">{config?.mode === 'test' ? t('RAZORPAY TEST MODE · NO REAL PAYMENT', 'RAZORPAY परीक्षण मोड · असली भुगतान नहीं') : t('PAYMENT DETAILS STAY WITH RAZORPAY', 'भुगतान का विवरण RAZORPAY के पास रहता है')}</p>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </dialog>
  );
}
