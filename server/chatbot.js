import { CHAT_SYSTEM_PROMPT } from './chatSystemPrompt.js';
import { getTherapyGroupId } from '../assets/js/domain/therapyGroupModel.js';
import { redactContactText } from './contactRedaction.js';

const INTENTS = new Set([
  'GREETING', 'SERVICE_DISCOVERY', 'SERVICE_RECOMMENDATION', 'SERVICE_DETAILS', 'PRICE_INQUIRY',
  'BUDGET_FILTER', 'DURATION_FILTER', 'BOOKING_REQUEST', 'AVAILABILITY_CHECK', 'BOOKING_STATUS',
  'BOOKING_CANCEL_REQUEST', 'HEALTH_SAFETY',
  'SPA_INFORMATION', 'BUSINESS_HOURS', 'PROMOTION_INQUIRY', 'CONTACT_SUPPORT', 'HUMAN_HANDOFF', 'FALLBACK', 'OUT_OF_SCOPE',
]);

const CATEGORY_HINTS = [
  { key: 'body-massage', pattern: /massage body|body massage|massage toan than|massage toan than/ },
  { key: 'skin-care', pattern: /cham soc da|duong da|da mat|facial|dermalogica|skincare/ },
  { key: 'packages', pattern: /goi tri lieu|goi spa|combo|package/ },
  { key: 'relaxation', pattern: /can thu gian|muon thu gian|thu gian|relax/ },
];

const SERVICE_FOCUS_HINTS = [
  { key: 'neck-shoulder', pattern: /\b(?:co\s+vai(?:\s+gay)?|co\s+gay|vung\s+co|massage\s+co|vai(?:\s+gay)?|gay|shoulder|neck)\b/ },
  { key: 'foot-massage', pattern: /\b(?:ban\s+chan|massage\s+chan|ngam\s+chan|chan|foot|reflexology)\b/ },
  { key: 'head-face', pattern: /\b(?:da\s+dau|(?:massage|masa|dich\s+vu|lieu\s+trinh|goi)\s+(?:da\s+)?dau|dau\s+mat|head|scalp)\b/ },
  { key: 'back', pattern: /\b(?:lung\s+tren|massage\s+lung|vung\s+lung|lung|back)\b/ },
  { key: 'body-massage', pattern: /\b(?:massage\s+body|body\s+massage|toan\s+than|full\s+body)\b/ },
];

export function normalizeChatText(value) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');
}

export function emptyChatContext() {
  return {
    intent: 'GREETING', service_category: null, service_id: null,
    budget_min: null, budget_max: null, desired_duration: null,
    preferred_date: null, preferred_time: null, employee_preference: null,
    booking_state: 'idle', conversation_state: 'greeting', keywords: [],
    sort_by: 'relevance', exclude_service_id: null, last_recommended_services: [], service_focus: null,
  };
}

function parseAmount(raw, unit = '') {
  const value = String(raw || '').trim();
  const normalizedUnit = normalizeChatText(unit);
  let amount;
  if (/[.,]\d{3}$/.test(value)) amount = Number(value.replace(/[.,]/g, ''));
  else amount = Number(value.replace(',', '.'));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (/^(k|nghin|ngan)$/.test(normalizedUnit)) amount *= 1000;
  else if (normalizedUnit === 'trieu') amount *= 1000000;
  else if (/^(d|dong)$/.test(normalizedUnit)) { /* Explicit VND unit. */ }
  else if (amount <= 10000) amount *= 1000;
  return Number.isSafeInteger(Math.round(amount)) && amount <= 50000000 ? Math.round(amount) : null;
}

export function extractBudget(text) {
  const value = normalizeChatText(text).replace(/[–—]/g, '-');
  const number = '(\\d+(?:[.,]\\d{1,3})?)';
  const unit = '(k|nghin|ngan|trieu|d|dong)?';
  const range = value.match(new RegExp(`${number}\\s*${unit}\\s*(?:-|den|toi)\\s*${number}\\s*${unit}`));
  if (range) {
    const sharedUnit = range[4] || range[2] || '';
    const min = parseAmount(range[1], range[2] || sharedUnit);
    const max = parseAmount(range[3], range[4] || sharedUnit);
    if (min != null && max != null && min <= max) return { budget_min: min, budget_max: max };
  }

  const below = value.match(new RegExp(`(?:duoi|toi da|khong qua|it hon|<=|<)\\s*${number}\\s*${unit}`));
  if (below) {
    const max = parseAmount(below[1], below[2]);
    if (max != null) return { budget_min: null, budget_max: max };
  }
  const above = value.match(new RegExp(`(?:tren|hon|tu|>=|>)\\s*${number}\\s*${unit}`));
  if (above) {
    const min = parseAmount(above[1], above[2]);
    if (min != null) return { budget_min: min, budget_max: null };
  }
  const approximate = value.match(new RegExp(`(?:khoang|tam|ngan sach|budget)\\s*(?:la)?\\s*${number}\\s*${unit}`));
  if (approximate) {
    const max = parseAmount(approximate[1], approximate[2]);
    if (max != null) return { budget_min: null, budget_max: max };
  }
  return null;
}

export function extractDuration(text) {
  const value = normalizeChatText(text);
  const minutes = value.match(/\b(\d{1,3})\s*(?:phut|p)\b/);
  if (minutes) {
    const duration = Number(minutes[1]);
    if (duration >= 15 && duration <= 480) return duration;
  }
  const hours = value.match(/\b(\d{1,2})\s*(?:tieng|gio|h)\b/);
  if (hours) {
    const duration = Number(hours[1]) * 60;
    if (duration >= 15 && duration <= 480) return duration;
  }
  if (/mot tieng|1 tieng/.test(value)) return 60;
  if (/nua tieng|nua gio|30 phut/.test(value)) return 30;
  return null;
}

function businessDate(offset = 0) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const part = (type) => parts.find((item) => item.type === type).value;
  const date = new Date(`${part('year')}-${part('month')}-${part('day')}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function extractDateAndTime(text) {
  const value = normalizeChatText(text);
  let date = null;
  // Accent folding makes “này” == “nay” and “mãi” == “mai”. Require date phrases
  // or a short date answer so ordinary service/promotion follow-ups keep their date.
  if (/\bhom nay\b/.test(value) || value === 'nay') date = businessDate(0);
  else if (/\b(?:ngay|sang|trua|chieu|toi) mai\b/.test(value) || /^mai(?:$| (?:luc|vao|co lich|con lich|dat lich)\b)/.test(value)) date = businessDate(1);
  else if (/\bngay kia\b/.test(value) || value === 'kia') date = businessDate(2);
  const weekday = value.match(/\bthu\s*([2-7])\b|\bchu nhat\b/);
  if (weekday) {
    const targetDay = weekday[0].startsWith('chu') ? 0 : Number(weekday[1]) - 1;
    const today = new Date(`${businessDate(0)}T00:00:00Z`).getUTCDay();
    date = businessDate((targetDay - today + 7) % 7);
  }
  const iso = value.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  const local = value.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](20\d{2}))?\b/);
  if (iso && validDate(iso[1])) date = iso[1];
  if (local) {
    const year = Number(local[3] || new Intl.DateTimeFormat('en', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric' }).format(new Date()));
    const candidate = `${year}-${String(Number(local[2])).padStart(2, '0')}-${String(Number(local[1])).padStart(2, '0')}`;
    if (validDate(candidate)) date = candidate;
  }

  let time = null;
  const meridiem = value.match(/\b(sang|trua|chieu|toi|am|pm)\b/)?.[1] || null;
  const explicitTime = value.match(/\b([01]?\d|2[0-3])\s*(?::|h)\s*([0-5]\d)?\b/);
  if (explicitTime) {
    let hour = Number(explicitTime[1]);
    if (['chieu', 'toi', 'pm'].includes(meridiem) && hour < 12) hour += 12;
    else if (['sang', 'am'].includes(meridiem) && hour === 12) hour = 0;
    else if (!meridiem && hour >= 1 && hour <= 6) hour += 12;
    time = `${String(hour).padStart(2, '0')}:${String(Number(explicitTime[2] || 0)).padStart(2, '0')}`;
  }
  else if (/\b(luc|vao|gio)\b/.test(value)) {
    const hourOnly = value.match(/\b([01]?\d|2[0-3])\s*(?:gio|h)\b/);
    if (hourOnly) {
      let hour = Number(hourOnly[1]);
      if (['chieu', 'toi', 'pm'].includes(meridiem) && hour < 12) hour += 12;
      else if (!meridiem && hour >= 1 && hour <= 6) hour += 12;
      time = `${String(hour).padStart(2, '0')}:00`;
    }
  }
  return { preferred_date: date, preferred_time: time };
}

function serviceMatch(text, services) {
  const normalized = normalizeChatText(text);
  return services.find((service) => {
    const name = normalizeChatText(service.name);
    return name.length >= 6 && normalized.includes(name);
  }) || services.find((service) => normalized.includes(String(service.id || '').replace(/-/g, ' '))) || null;
}

function referencedService(text, context, services) {
  const value = normalizeChatText(text);
  const ordinal = value.match(/\b(?:cai\s+)?(?:thu\s+)?(1|2|3|nhat|nhi|hai|ba)\b/);
  const ordinalMap = { '1': 0, nhat: 0, '2': 1, nhi: 1, hai: 1, '3': 2, ba: 2 };
  let reference = null;
  if (ordinal && /\b(cai|thu|dich vu|lieu trinh)\b/.test(value)) {
    reference = (context.last_recommended_services || [])[ordinalMap[ordinal[1]]];
  } else if (/\b(cai do|cai nay|dich vu do|dich vu nay|lieu trinh do|lieu trinh nay)\b/.test(value)) {
    reference = context.service_id || (context.last_recommended_services || [])[0];
  } else if (context.service_id && /\b(gia|bao nhieu|dat|lich|con khong)\b/.test(value)) {
    reference = context.service_id;
  }
  const id = typeof reference === 'string' ? reference : reference?.serviceId || reference?.id;
  return id ? services.find((service) => service.id === id && service.active !== false) || null : null;
}

export function classifyChatMessage(message, context = emptyChatContext(), services = [], preferredServiceId = null) {
  const text = String(message || '').trim();
  const value = normalizeChatText(text);
  const budget = extractBudget(text);
  const clearBudget = /^bo ngan sach$/.test(value);
  const dateTime = extractDateAndTime(text);
  const duration = context.conversation_state === 'awaiting_availability_time' && dateTime.preferred_time
    ? null : extractDuration(text);
  const category = CATEGORY_HINTS.find(({ pattern }) => pattern.test(value))?.key || null;
  const detectedFocus = SERVICE_FOCUS_HINTS.find(({ pattern }) => pattern.test(value))?.key || null;
  const focusChanged = Boolean(detectedFocus && detectedFocus !== context.service_focus);
  const categoryChanged = Boolean(category && category !== context.service_category);
  const serviceFocus = detectedFocus || (categoryChanged ? null : context.service_focus) || null;
  const preferredService = services.find((service) => service.id === preferredServiceId && service.active !== false) || null;
  const matchedService = preferredService || serviceMatch(text, services);
  const referenced = referencedService(text, context, services);
  const selectedService = matchedService || referenced;
  const wantsCheaper = /\b(re nhat|gia re nhat|gia thap nhat|muc gia thap nhat|re hon)\b/.test(value);
  let intent = 'FALLBACK';

  if (/^(xin chao|chao|hello|hi|alo|hey)\b/.test(value)) intent = 'GREETING';
  else if (/trieu chung|benh ly|chua benh|dieu tri benh|di ung|mang thai|chay mau|sot cao|tu van thuoc/.test(value)) intent = 'HEALTH_SAFETY';
  else if (/nhan vien|tu van vien|gap nguoi|goi cho|lien he nhan vien|ho tro truc tiep/.test(value)) intent = 'HUMAN_HANDOFF';
  else if (/lich hen cua toi|lich cua toi|booking cua toi|lich da dat/.test(value)) intent = 'BOOKING_STATUS';
  else if (/huy lich|doi lich|thay doi lich|reschedule|cancel booking/.test(value)) intent = 'BOOKING_CANCEL_REQUEST';
  else if (/gio mo cua|gio hoat dong|mo cua may gio|dong cua may gio/.test(value)) intent = 'BUSINESS_HOURS';
  else if (/dia chi|o dau|chi duong|so dien thoai|hotline|lien he/.test(value)) intent = 'SPA_INFORMATION';
  else if (/khuyen mai|uu dai|ma giam|voucher|discount|promo/.test(value)) intent = 'PROMOTION_INQUIRY';
  else if (/lich trong|kiem tra lich|con slot|khung gio|gio trong|available|con lich|lich.*con/.test(value)) intent = 'AVAILABILITY_CHECK';
  else if (/dat lich|dat hen|book lich|book ngay|muon dat/.test(value) || (selectedService && /\bdat\b/.test(value))) intent = 'BOOKING_REQUEST';
  else if (context.conversation_state === 'awaiting_availability_date' && dateTime.preferred_date) intent = 'AVAILABILITY_CHECK';
  else if (context.conversation_state === 'awaiting_availability_time' && dateTime.preferred_time) intent = 'AVAILABILITY_CHECK';
  else if (/^(bat dau lai|lam lai|tro ve menu|menu chinh|hoi lai tu dau)$/.test(value)) intent = 'SERVICE_DISCOVERY';
  else if (/xem menu|menu dich vu|danh sach dich vu|xem hinh anh|hinh anh menu|cho xem.*dich vu/.test(value)) intent = 'SERVICE_DISCOVERY';
  else if (/gia bao nhieu|bao nhieu tien|gia tien|gia cua|price/.test(value) || (selectedService && /\b(bao nhieu|gia)\b/.test(value))) intent = 'PRICE_INQUIRY';
  else if (budget) intent = 'BUDGET_FILTER';
  else if (clearBudget) intent = 'SERVICE_RECOMMENDATION';
  else if (duration) intent = 'DURATION_FILTER';
  else if (wantsCheaper) intent = 'SERVICE_RECOMMENDATION';
  else if (selectedService) intent = 'SERVICE_DETAILS';
  else if (category || detectedFocus || /massage|cham soc da|dich vu|lieu trinh|thu gian|vai gay|co vai|met moi|stress|ngan sach|phut|tieng/.test(value)) {
    intent = 'SERVICE_RECOMMENDATION';
  }

  if (intent === 'FALLBACK' && context.conversation_state === 'awaiting_availability_date' && dateTime.preferred_date) {
    intent = 'AVAILABILITY_CHECK';
  } else if (intent === 'FALLBACK' && context.conversation_state === 'awaiting_availability_time' && dateTime.preferred_time) {
    intent = 'AVAILABILITY_CHECK';
  } else if (intent === 'FALLBACK' && context.conversation_state === 'awaiting_budget' && budget) {
    intent = 'BUDGET_FILTER';
  }

  const budgetChanged = Boolean(budget);
  const contextPatch = {
    intent,
    service_category: category || (focusChanged ? null : context.service_category) || null,
    service_focus: serviceFocus,
    service_id: selectedService?.id || (categoryChanged || focusChanged ? null : context.service_id) || null,
    ...(wantsCheaper
      ? { sort_by: 'price_asc', exclude_service_id: selectedService?.id || context.service_id || null }
      : focusChanged ? { sort_by: 'price_asc' } : {}),
    ...(budget ? budget : clearBudget ? { budget_min: null, budget_max: null } : {}),
    ...(duration ? { desired_duration: duration } : {}),
    ...(dateTime.preferred_date ? { preferred_date: dateTime.preferred_date } : {}),
    ...(dateTime.preferred_time ? { preferred_time: dateTime.preferred_time } : {}),
    keywords: text.length > 16
      ? [...new Set(value.split(/[^a-z0-9]+/).filter((word) => word.length > 3 && !/^\d+$/.test(word) && !['minh', 'muon', 'can', 'cho', 'mot', 'nua', 'voi', 'khoang', 'dang', 'thuong', 'ngan', 'sach'].includes(word)))].slice(0, 8)
      : (context.keywords || []),
  };
  return { intent, contextPatch, reset: /^(bat dau lai|lam lai|tro ve menu|menu chinh|hoi lai tu dau)$/.test(value), budgetChanged: Boolean(budget || clearBudget) };
}

function safeInteger(value, min, max) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= min && number <= max ? number : null;
}

export function validateAiCriteria(candidate, categories = []) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
  const allowedCategories = new Set([
    'body-massage', 'skin-care', 'relaxation', 'packages',
    ...categories.map((category) => String(category.id || '')),
  ]);
  const category = allowedCategories.has(String(candidate.service_category || '')) ? candidate.service_category : null;
  const intent = INTENTS.has(candidate.intent) ? candidate.intent : null;
  const keywords = Array.isArray(candidate.keywords)
    ? candidate.keywords.filter((word) => typeof word === 'string').slice(0, 6).map((word) => word.trim().slice(0, 32)).filter(Boolean)
    : [];
  return {
    intent,
    service_category: category,
    budget_min: safeInteger(candidate.budget_min, 0, 50000000),
    budget_max: safeInteger(candidate.budget_max, 0, 50000000),
    desired_duration: safeInteger(candidate.desired_duration, 15, 480),
    sort_by: candidate.sort_by === 'price_asc' ? 'price_asc' : 'relevance',
    keywords,
  };
}

export function mergeChatContext(previous, ruleResult, aiCriteria = null) {
  if (ruleResult.reset) return emptyChatContext();
  const next = { ...emptyChatContext(), ...(previous || {}), ...(ruleResult.contextPatch || {}) };
  if (aiCriteria) {
    if (!ruleResult.contextPatch.service_category && !ruleResult.contextPatch.service_focus && aiCriteria.service_category) {
      next.service_category = aiCriteria.service_category;
    }
    if (!ruleResult.contextPatch.budget_min && !ruleResult.contextPatch.budget_max) {
      if (aiCriteria.budget_min != null) next.budget_min = aiCriteria.budget_min;
      if (aiCriteria.budget_max != null) next.budget_max = aiCriteria.budget_max;
    }
    if (!ruleResult.contextPatch.desired_duration && aiCriteria.desired_duration) next.desired_duration = aiCriteria.desired_duration;
    if (!ruleResult.contextPatch.sort_by && aiCriteria.sort_by === 'price_asc') next.sort_by = 'price_asc';
    if (aiCriteria.keywords?.length) next.keywords = [...new Set([...(previous?.keywords || []), ...aiCriteria.keywords])].slice(-8);
    const conversationalIntents = new Set([
      'GREETING', 'SERVICE_DISCOVERY', 'SERVICE_RECOMMENDATION', 'SERVICE_DETAILS',
      'PRICE_INQUIRY', 'BUDGET_FILTER', 'DURATION_FILTER', 'OUT_OF_SCOPE', 'HEALTH_SAFETY',
    ]);
    if (ruleResult.intent === 'FALLBACK' && conversationalIntents.has(aiCriteria.intent)) next.intent = aiCriteria.intent;
  }
  if (next.budget_min != null && next.budget_max != null && next.budget_min > next.budget_max) next.budget_min = null;
  if (!ruleResult.budgetChanged && !aiCriteria?.budget_min && !aiCriteria?.budget_max) {
    next.budget_min = previous?.budget_min ?? null;
    next.budget_max = previous?.budget_max ?? null;
  }
  next.conversation_state = next.intent === 'BOOKING_REQUEST' ? 'booking_handoff'
    : next.intent === 'AVAILABILITY_CHECK' ? 'availability'
      : next.service_id ? 'service_selected' : 'recommendations';
  return next;
}

function variantsFor(service) {
  const variants = [...(Array.isArray(service.variants) ? service.variants : []), { duration: service.duration, price: service.price }];
  const unique = new Map();
  for (const variant of variants) {
    const duration = Number(variant.duration);
    const price = Number(variant.price);
    if (Number.isInteger(duration) && duration > 0 && Number.isFinite(price) && price >= 0) unique.set(`${duration}:${price}`, { duration, price });
  }
  return [...unique.values()];
}

function categoryMatches(service, category) {
  const categoryId = normalizeChatText(service.category);
  const haystack = normalizeChatText(`${service.name || ''} ${service.shortDesc || ''} ${service.fullDesc || ''} ${(service.benefits || []).join(' ')}`);
  if (category === 'body-massage') return categoryId === 'body-massages' || /massage body|body massage/.test(haystack);
  if (category === 'skin-care') return /facial|cham soc da|da mat|dermalogica|tay te bao chet|duong da/.test(haystack);
  if (category === 'packages') return categoryId === 'packages';
  if (category === 'relaxation') return ['body-massages', 'focus-therapy', 'hair-spa'].includes(categoryId) && !/tay te bao chet/.test(haystack);
  return categoryId === normalizeChatText(category);
}

function serviceFocusMatches(service, focus) {
  if (!focus) return true;
  const group = getTherapyGroupId(service);
  const haystack = normalizeChatText(`${service.name || ''} ${service.shortDesc || ''} ${service.fullDesc || ''} ${(service.benefits || []).join(' ')}`);
  if (group) {
    if (focus === 'neck-shoulder' && group === 'special-combo') return /vai gay|co vai|co gay|shoulder massage/.test(haystack);
    if (focus === 'back') return group === 'neck-shoulder' && /lung tren|massage lung|vung lung|back massage/.test(haystack);
    return group === focus;
  }
  if (focus === 'neck-shoulder') return /\bvai\b|vai gay|co vai|co gay|shoulder|neck/.test(haystack);
  if (focus === 'foot-massage') return /massage chan|ban chan|foot reflexology/.test(haystack);
  if (focus === 'head-face') return /massage dau|da dau|goi dau|head massage|facial/.test(haystack);
  if (focus === 'body-massage') return /massage body|body massage|toan than|full body/.test(haystack);
  if (focus === 'back') return /lung tren|massage lung|vung lung|back massage/.test(haystack);
  return true;
}

export function recommendServices(services, context, limit = 3) {
  const words = new Set((context.keywords || []).flatMap((value) => normalizeChatText(value).split(/[^a-z0-9]+/)).filter((word) => word.length > 3));
  const results = (services || []).filter((service) => service && service.active !== false && service.id !== context.exclude_service_id).flatMap((service) => {
    if (context.service_category && !categoryMatches(service, context.service_category)) return [];
    if (!serviceFocusMatches(service, context.service_focus)) return [];
    const haystack = normalizeChatText(`${service.name || ''} ${service.category || ''} ${service.therapyGroup || ''} ${service.shortDesc || ''} ${service.fullDesc || ''} ${(service.benefits || []).join(' ')}`);
    const variants = variantsFor(service).filter((variant) =>
      (context.budget_min == null || variant.price >= context.budget_min) &&
      (context.budget_max == null || variant.price <= context.budget_max));
    if (!variants.length) return [];
    const chosen = variants.sort((a, b) => {
      if (context.desired_duration) return Math.abs(a.duration - context.desired_duration) - Math.abs(b.duration - context.desired_duration) || a.price - b.price;
      return a.price - b.price;
    })[0];
    const keywordScore = [...words].reduce((score, word) => score + (haystack.includes(word) ? 1 : 0), 0);
    const durationScore = context.desired_duration ? Math.max(0, 1 - Math.abs(chosen.duration - context.desired_duration) / 180) : 0;
    return [{
      id: service.id, name: service.name, imageId: service.imageId || null,
      ...(service.imageUrl ? { imageUrl: service.imageUrl } : {}),
      shortDesc: String(service.shortDesc || '').slice(0, 240), category: service.category,
      categoryName: service.categoryName || service.category, price: chosen.price, duration: chosen.duration,
      score: keywordScore + durationScore,
    }];
  });
  results.sort((a, b) => context.sort_by === 'price_asc'
    ? a.price - b.price || b.score - a.score || a.name.localeCompare(b.name, 'vi')
    : b.score - a.score || a.price - b.price || a.name.localeCompare(b.name, 'vi'));
  return results.slice(0, Math.max(1, Math.min(5, limit)));
}

export function redactChatText(value) {
  return redactContactText(String(value || '').slice(0, 1200));
}

function aiConfiguration(env) {
  const provider = String(env.AI_PROVIDER || '').toLowerCase();
  if (!['openai', 'gemini'].includes(provider)) return null;
  const key = provider === 'gemini'
    ? env.GEMINI_API_KEY || env.AI_API_KEY
    : env.AI_API_KEY || env.OPENAI_API_KEY;
  const model = String(env.AI_MODEL || '').trim();
  return key && model ? { provider, key, model } : null;
}

export function isAiConfigured(env = process.env) {
  return Boolean(aiConfiguration(env));
}

export async function requestAiCriteria(message, context, categories, env = process.env, fetcher = fetch, options = {}) {
  const config = aiConfiguration(env);
  if (!config) return null;
  const { provider, key, model } = config;
  const timeoutMs = Math.max(1000, Math.min(15000, Number(env.AI_REQUEST_TIMEOUT || 4500)));
  const maxTokens = Math.max(120, Math.min(700, Number(env.AI_MAX_OUTPUT_TOKENS || 420)));
  const fallbackModel = provider === 'gemini'
    ? String(env.AI_FALLBACK_MODEL || 'gemini-3.5-flash-lite').trim()
    : '';
  const models = [model, ...(fallbackModel && fallbackModel !== model ? [fallbackModel] : [])];
  const deadline = Date.now() + timeoutMs;
  let activeModel = model;
  try {
    const systemPrompt = CHAT_SYSTEM_PROMPT;
    const userPayload = JSON.stringify({ message: redactChatText(message), history: (options.history || []).slice(-8).map((item) => ({
      role: item.role === 'assistant' ? 'assistant' : 'user', content: redactChatText(String(item.content || '').slice(-600)),
    })), context: {
      intent: options.ruleIntent || context.intent,
      service_category: context.service_category, budget_min: context.budget_min, budget_max: context.budget_max,
      desired_duration: context.desired_duration, preferred_date: context.preferred_date, preferred_time: context.preferred_time,
      selected_service_id: context.service_id,
      service_focus: context.service_focus || null,
      last_recommended_service_ids: (context.last_recommended_services || []).map((item) => typeof item === 'string' ? item : item?.serviceId).filter(Boolean).slice(0, 5),
      sort_by: context.sort_by,
    }, candidate_services: (options.candidateServices || []).slice(0, 5).map((service) => ({
      id: String(service.id || '').slice(0, 100), name: String(service.name || '').slice(0, 120),
      category: String(service.categoryName || service.category || '').slice(0, 100),
      description: redactChatText(String(service.shortDesc || '').slice(0, 240)),
      price: Number(service.price), duration: Number(service.duration),
    })), allowed_categories: [...categories.map((category) => ({ id: category.id, name: category.name })),
      { id: 'body-massage', name: 'Body massage' }, { id: 'skin-care', name: 'Skin care' },
      { id: 'relaxation', name: 'Relaxation' }, { id: 'packages', name: 'Packages' }] });
    const isGemini = provider === 'gemini';
    for (let index = 0; index < models.length; index += 1) {
      activeModel = models[index];
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) return null;
      const primaryAttemptMs = Math.max(500, Math.floor(timeoutMs * 0.25));
      const attemptTimeoutMs = isGemini && index === 0 && models.length > 1
        ? Math.min(remainingMs, primaryAttemptMs)
        : remainingMs;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), attemptTimeoutMs);
      try {
        if (process.env.NODE_ENV !== 'production') console.info(`[GEMINI REQUEST] model=${activeModel} message count=${(options.history || []).length + 1}`);
        const geminiGenerationConfig = { maxOutputTokens: maxTokens, responseMimeType: 'application/json' };
        if (/^gemini-(?:3|4)(?:[.-]|$)/i.test(activeModel)) {
          geminiGenerationConfig.thinkingConfig = { thinkingLevel: 'low' };
        }
        const response = await fetcher(isGemini
          ? `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(activeModel)}:generateContent`
          : 'https://api.openai.com/v1/chat/completions', {
          method: 'POST', signal: controller.signal,
          headers: isGemini
            ? { 'x-goog-api-key': key, 'Content-Type': 'application/json' }
            : { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(isGemini ? {
            systemInstruction: { parts: [{ text: CHAT_SYSTEM_PROMPT }] },
            contents: [{ role: 'user', parts: [{ text: userPayload }] }],
            generationConfig: geminiGenerationConfig,
          } : {
            model: activeModel, temperature: 0, max_completion_tokens: maxTokens,
            response_format: { type: 'json_object' },
            messages: [{ role: 'system', content: CHAT_SYSTEM_PROMPT }, { role: 'user', content: userPayload }],
          }),
        });
        if (!response.ok) {
          const canFailOver = isGemini && index === 0 && models.length > 1
            && [408, 429, 500, 502, 503, 504].includes(response.status);
          if (canFailOver) {
            console.warn(`[chatbot-ai] Gemini model ${activeModel} returned HTTP ${response.status}; trying ${models[index + 1]}.`);
            continue;
          }
          console.warn(`[chatbot-ai] ${provider} model ${activeModel} returned HTTP ${response.status}; returning controlled AI-unavailable response.`);
          return null;
        }
        const data = await response.json();
        if (process.env.NODE_ENV !== 'production') {
          console.info(`[AI RESULT] provider=${provider} status=${response.status ?? (response.ok ? 200 : 0)} response type=${Array.isArray(data?.candidates) ? 'candidate' : 'unknown'} tool calls=0`);
        }
        const content = provider === 'gemini'
          ? data?.candidates?.[0]?.content?.parts?.map((part) => part.text).filter((part) => typeof part === 'string').join('')
          : data?.choices?.[0]?.message?.content;
        if (typeof content !== 'string' || content.length > 6000) {
          console.warn(`[chatbot-ai] ${provider} model ${activeModel} returned no usable text; returning controlled invalid-response status.`);
          return null;
        }
        let parsed;
        try { parsed = JSON.parse(content); } catch {
          console.warn(`[chatbot-ai] ${provider} model ${activeModel} returned invalid JSON; returning controlled invalid-response status.`);
          return null;
        }
        const validated = validateAiCriteria(parsed, categories);
        const assistantReply = typeof parsed?.assistant_reply === 'string'
          ? redactChatText(parsed.assistant_reply.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()).slice(0, 600)
          : '';
        if (!validated?.intent || !assistantReply) {
          console.warn(`[chatbot-ai] ${provider} model ${activeModel} returned an incomplete response; returning controlled invalid-response status.`);
          return null;
        }
        return { ...validated, assistant_reply: assistantReply };
      } catch (error) {
        const canFailOver = isGemini && index === 0 && models.length > 1
          && (error?.name === 'AbortError' || error?.name === 'TimeoutError'
            || error instanceof TypeError || error instanceof SyntaxError);
        if (canFailOver) {
          const failureKind = error?.cause?.code || error?.name || 'unknown';
          console.warn(`[chatbot-ai] Gemini model ${activeModel} request failed (${failureKind}); trying ${models[index + 1]}.`);
          continue;
        }
        throw error;
      } finally {
        clearTimeout(timer);
      }
    }
    return null;
  } catch (error) {
    const failureKind = error?.cause?.code || error?.name || 'unknown';
    console.warn(`[chatbot-ai] ${provider} model ${activeModel} request failed (${failureKind}); returning controlled AI-unavailable response.`);
    return null;
  }
}

export const CHAT_MAX_MESSAGE_LENGTH = 1200;
