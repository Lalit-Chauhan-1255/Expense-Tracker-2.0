const crypto = require('crypto');
const express = require('express');
const fs = require('fs');
const session = require('express-session');
const path = require('path');

const app = express();
const PORT = 4001;
const PAGE_SIZE = 6;
const STORE_PATH = path.join(__dirname, 'data', 'store.json');
const INCOME_CATEGORIES = ['Salary', 'Savings', 'Sales', 'Design', 'Freelance', 'Rental', 'Investment', 'Other'];
const EXPENSE_CATEGORIES = ['Shopping', 'Travel', 'Utilities', 'Loans', 'Food', 'Transport', 'Education', 'Entertainment', 'Groceries', 'Fuel', 'Medical', 'Internet', 'Other'];

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: 'expense-tracker-ui-secret',
  resave: false,
  saveUninitialized: false
}));

const money = value => `$${Number(value || 0).toLocaleString('en-US')}`;

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeEmail(value) {
  return normalizeText(value);
}

function deriveInitials(fullName) {
  const parts = String(fullName || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  if (!parts.length) {
    return 'ET';
  }

  return parts.map(part => part[0].toUpperCase()).join('');
}

function inferCategory(title, type) {
  const normalized = normalizeText(title);
  const matchTable = type === 'income'
    ? [
        ['salary', 'Salary'],
        ['saving', 'Savings'],
        ['sale', 'Sales'],
        ['design', 'Design'],
        ['freelance', 'Freelance'],
        ['rental', 'Rental'],
        ['stock', 'Investment'],
        ['invest', 'Investment']
      ]
    : [
        ['shop', 'Shopping'],
        ['travel', 'Travel'],
        ['electric', 'Utilities'],
        ['internet', 'Internet'],
        ['phone', 'Internet'],
        ['loan', 'Loans'],
        ['food', 'Food'],
        ['dining', 'Food'],
        ['grocery', 'Groceries'],
        ['transport', 'Transport'],
        ['fuel', 'Fuel'],
        ['education', 'Education'],
        ['movie', 'Entertainment'],
        ['entertainment', 'Entertainment'],
        ['medical', 'Medical']
      ];

  const found = matchTable.find(([needle]) => normalized.includes(needle));
  return found ? found[1] : 'Other';
}

function createEmptyStore() {
  return {
    nextEntryId: 100,
    nextUserId: 1,
    users: [],
    incomeEntries: [],
    expenseEntries: []
  };
}

function ensureStoreFile() {
  if (!fs.existsSync(path.dirname(STORE_PATH))) {
    fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
  }

  if (!fs.existsSync(STORE_PATH)) {
    fs.writeFileSync(STORE_PATH, JSON.stringify(createEmptyStore(), null, 2));
  }
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(password, salt, 120000, 64, 'sha512').toString('hex');
  return { salt, hash };
}

function verifyPassword(password, user) {
  if (!user || !user.passwordSalt || !user.passwordHash) {
    return false;
  }

  const computedHash = crypto.pbkdf2Sync(password, user.passwordSalt, 120000, 64, 'sha512').toString('hex');
  return crypto.timingSafeEqual(Buffer.from(computedHash, 'hex'), Buffer.from(user.passwordHash, 'hex'));
}

function readStore() {
  ensureStoreFile();

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
  } catch (error) {
    parsed = createEmptyStore();
  }

  const users = Array.isArray(parsed.users)
    ? parsed.users.map(user => ({
        id: Number(user.id),
        fullName: String(user.fullName || '').trim(),
        email: normalizeEmail(user.email),
        passwordSalt: String(user.passwordSalt || ''),
        passwordHash: String(user.passwordHash || ''),
        createdAt: user.createdAt || new Date().toISOString()
      })).filter(user => user.id && user.fullName && user.email)
    : [];

  const fallbackUserId = users.length ? users[0].id : null;
  const nextEntryId = Math.max(Number(parsed.nextEntryId) || 100, 100);
  const nextUserId = Math.max(Number(parsed.nextUserId) || (users.reduce((max, user) => Math.max(max, user.id), 0) + 1), 1);

  const normalizeEntry = (entry, type) => {
    const amount = Math.abs(Number(entry.amount) || 0);
    return {
      id: Number(entry.id),
      userId: entry.userId ? Number(entry.userId) : fallbackUserId,
      title: String(entry.title || '').trim(),
      category: String(entry.category || inferCategory(entry.title, type)).trim(),
      date: String(entry.date || '').trim(),
      amount: type === 'expense' ? -amount : amount,
      icon: String(entry.icon || (type === 'expense' ? '🧾' : '💼')).trim() || (type === 'expense' ? '🧾' : '💼')
    };
  };

  return {
    nextEntryId,
    nextUserId,
    users,
    incomeEntries: Array.isArray(parsed.incomeEntries)
      ? parsed.incomeEntries.map(entry => normalizeEntry(entry, 'income')).filter(entry => entry.id && entry.title && entry.date)
      : [],
    expenseEntries: Array.isArray(parsed.expenseEntries)
      ? parsed.expenseEntries.map(entry => normalizeEntry(entry, 'expense')).filter(entry => entry.id && entry.title && entry.date)
      : []
  };
}

function writeStore(store) {
  ensureStoreFile();
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}

function getSessionUserId(req) {
  const userId = Number(req.session.userId);
  return Number.isInteger(userId) && userId > 0 ? userId : null;
}

function getFilters(query) {
  const page = Math.max(1, Number(query.page) || 1);
  return {
    q: String(query.q || '').trim(),
    category: String(query.category || '').trim(),
    start: String(query.start || '').trim(),
    end: String(query.end || '').trim(),
    page
  };
}

function getFilterParams(filters) {
  return {
    q: filters.q,
    category: filters.category,
    start: filters.start,
    end: filters.end
  };
}

function buildQueryString(params) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      query.set(key, String(value));
    }
  });
  return query.toString();
}

function paginateEntries(entries, page, basePath, filters) {
  const totalItems = entries.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const items = entries.slice(startIndex, startIndex + PAGE_SIZE);
  const filterParams = getFilterParams(filters);
  const makeHref = targetPage => {
    const query = buildQueryString({ ...filterParams, page: targetPage > 1 ? targetPage : '' });
    return query ? `${basePath}?${query}` : basePath;
  };

  return {
    items,
    page: currentPage,
    pageSize: PAGE_SIZE,
    totalItems,
    totalPages,
    hasPrev: currentPage > 1,
    hasNext: currentPage < totalPages,
    prevHref: makeHref(currentPage - 1),
    nextHref: makeHref(currentPage + 1),
    pages: Array.from({ length: totalPages }, (_, index) => ({
      number: index + 1,
      href: makeHref(index + 1),
      active: index + 1 === currentPage
    }))
  };
}

function applyFilters(entries, filters) {
  const query = normalizeText(filters.q);
  return entries.filter(item => {
    const haystack = `${item.title} ${item.category}`.toLowerCase();
    const matchesText = !query || haystack.includes(query);
    const matchesCategory = !filters.category || item.category === filters.category;
    const matchesStart = !filters.start || item.date >= filters.start;
    const matchesEnd = !filters.end || item.date <= filters.end;
    return matchesText && matchesCategory && matchesStart && matchesEnd;
  });
}

function setFlash(req, type, message) {
  req.session.flash = { type, message };
}

function pullFlash(req) {
  const flash = req.session.flash || null;
  req.session.flash = null;
  return flash;
}

function getDaySuffix(day) {
  if (day >= 11 && day <= 13) return 'th';
  if (day % 10 === 1) return 'st';
  if (day % 10 === 2) return 'nd';
  if (day % 10 === 3) return 'rd';
  return 'th';
}

function formatDisplayDate(dateStr) {
  const date = new Date(dateStr);
  const day = date.getDate();
  const suffix = getDaySuffix(day);
  const month = date.toLocaleString('en-US', { month: 'short' });
  const year = date.getFullYear();
  return `${day}${suffix} ${month} ${year}`;
}

function formatTimelineLabel(dateStr) {
  const date = new Date(dateStr);
  const day = date.getDate();
  const suffix = getDaySuffix(day);
  const month = date.toLocaleString('en-US', { month: 'short' });
  return `${day}${suffix} ${month}`;
}

function buildMonthlySeries(entries, limit) {
  const buckets = new Map();

  [...entries]
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .forEach(entry => {
      const monthKey = entry.date.slice(0, 7);
      const date = new Date(`${monthKey}-01T00:00:00`);
      const label = date.toLocaleString('en-US', { month: 'short', year: '2-digit' });
      buckets.set(monthKey, {
        label,
        value: (buckets.get(monthKey)?.value || 0) + Math.abs(entry.amount)
      });
    });

  const points = Array.from(buckets.values()).slice(-limit);
  return {
    labels: points.map(point => point.label),
    values: points.map(point => point.value)
  };
}

function buildCategoryBreakdown(entries) {
  const totals = entries.reduce((accumulator, entry) => {
    const key = entry.category || 'Other';
    accumulator[key] = (accumulator[key] || 0) + Math.abs(entry.amount);
    return accumulator;
  }, {});

  const topCategories = Object.entries(totals)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 6);

  return {
    labels: topCategories.map(item => item[0]),
    values: topCategories.map(item => item[1])
  };
}

function buildRowItem(item, amount) {
  return {
    id: item.id,
    title: item.title,
    category: item.category,
    date: formatDisplayDate(item.date),
    rawDate: item.date,
    amount,
    icon: item.icon
  };
}

function buildIncomeViewModel(entries, filters) {
  const sorted = [...entries].sort((a, b) => new Date(b.date) - new Date(a.date));
  const timeline = [...entries].sort((a, b) => new Date(a.date) - new Date(b.date)).slice(-12);
  const pagination = paginateEntries(sorted, filters.page, '/income', filters);
  const queryBase = buildQueryString(getFilterParams(filters));

  return {
    filters,
    queryBase,
    downloadQuery: queryBase,
    timelineLabels: timeline.map(item => formatTimelineLabel(item.date)),
    timelineValues: timeline.map(item => Math.abs(item.amount)),
    sources: pagination.items.map(item => buildRowItem(item, Math.abs(item.amount))),
    pagination
  };
}

function buildExpenseViewModel(entries, filters) {
  const sorted = [...entries].sort((a, b) => new Date(b.date) - new Date(a.date));
  const timeline = [...entries].sort((a, b) => new Date(a.date) - new Date(b.date)).slice(-14);
  const pagination = paginateEntries(sorted, filters.page, '/expense', filters);
  const queryBase = buildQueryString(getFilterParams(filters));

  return {
    filters,
    queryBase,
    downloadQuery: queryBase,
    timelineLabels: timeline.map(item => formatTimelineLabel(item.date)),
    timelineValues: timeline.map(item => Math.abs(item.amount)),
    sources: pagination.items.map(item => buildRowItem(item, -Math.abs(item.amount))),
    pagination
  };
}

function buildDashboardViewModel(incomeEntries, expenseEntries) {
  const totalIncome = incomeEntries.reduce((sum, item) => sum + Math.abs(item.amount), 0);
  const totalExpense = expenseEntries.reduce((sum, item) => sum + Math.abs(item.amount), 0);
  const totalBalance = totalIncome - totalExpense;

  const recentTransactions = [...incomeEntries, ...expenseEntries]
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 5)
    .map(item => ({
      title: item.title,
      category: item.category,
      date: formatDisplayDate(item.date),
      amount: item.amount,
      icon: item.icon
    }));

  const latestExpenses = [...expenseEntries]
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 5)
    .map(item => ({
      title: item.title,
      category: item.category,
      date: formatDisplayDate(item.date),
      amount: item.amount,
      icon: item.icon
    }));

  const latestIncome = [...incomeEntries]
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 5)
    .map(item => ({
      title: item.title,
      category: item.category,
      date: formatDisplayDate(item.date),
      amount: Math.abs(item.amount),
      icon: item.icon
    }));

  return {
    cards: {
      balance: totalBalance,
      income: totalIncome,
      expense: totalExpense
    },
    recentTransactions,
    expenseList: latestExpenses,
    incomeList: latestIncome,
    expenseTrend: buildMonthlySeries(expenseEntries, 4),
    incomeTrend: buildMonthlySeries(incomeEntries, 4),
    expenseCategoryBreakdown: buildCategoryBreakdown(expenseEntries),
    incomeCategoryBreakdown: buildCategoryBreakdown(incomeEntries)
  };
}

function toCsv(rows, headers) {
  const escapeCell = value => {
    const stringValue = String(value ?? '');
    if (/[",\n]/.test(stringValue)) {
      return `"${stringValue.replace(/"/g, '""')}"`;
    }
    return stringValue;
  };

  const lines = [headers.join(',')];
  rows.forEach(row => {
    lines.push(row.map(escapeCell).join(','));
  });
  return lines.join('\n');
}

function updateEntry(storeEntries, id, userId, updater) {
  const index = storeEntries.findIndex(item => item.id === id && item.userId === userId);
  if (index === -1) {
    return false;
  }

  storeEntries[index] = updater(storeEntries[index]);
  return true;
}

function getUserEntries(store, userId) {
  return {
    incomeEntries: store.incomeEntries.filter(item => item.userId === userId),
    expenseEntries: store.expenseEntries.filter(item => item.userId === userId)
  };
}

function getDemoUserId(store, req) {
  return getSessionUserId(req) || (store.users.length ? store.users[0].id : null);
}

function getReadableEntries(store, req) {
  const activeUserId = getDemoUserId(store, req);
  if (activeUserId) {
    return getUserEntries(store, activeUserId);
  }

  return {
    incomeEntries: store.incomeEntries,
    expenseEntries: store.expenseEntries
  };
}

function setUserSession(req, user) {
  req.session.userId = user.id;
}

function clearUserSession(req) {
  req.session.userId = null;
}

function requireAuth(req, res, next) {
  if (getSessionUserId(req)) {
    return next();
  }
  return res.redirect('/login');
}

function renderSignup(res, options = {}) {
  res.render('signup', {
    error: options.error || null,
    message: options.message || null,
    values: options.values || { fullName: '', email: '' }
  });
}

function renderLogin(req, res, options = {}) {
  const flash = pullFlash(req);
  res.render('login', {
    error: options.error || null,
    message: options.message || (flash && flash.type === 'success' ? flash.message : null),
    values: options.values || { email: '' }
  });
}

app.use((req, res, next) => {
  const store = readStore();
  const currentUser = store.users.find(user => user.id === getSessionUserId(req)) || null;

  if (req.session.userId && !currentUser) {
    clearUserSession(req);
  }

  res.locals.currentUser = currentUser;
  res.locals.currentUserInitials = currentUser ? deriveInitials(currentUser.fullName) : 'ET';
  next();
});

app.get('/', (req, res) => {
  return res.redirect('/dashboard');
});

app.get('/signup', (req, res) => {
  if (getSessionUserId(req)) {
    return res.redirect('/dashboard');
  }
  return renderSignup(res);
});

app.post('/signup', (req, res) => {
  const store = readStore();
  const fullName = String(req.body.fullName || '').trim();
  const email = normalizeEmail(req.body.email);
  const password = String(req.body.password || '');
  const confirmPassword = String(req.body.confirmPassword || '');

  if (!fullName || !email || !password) {
    return renderSignup(res, {
      error: 'Please fill all required fields.',
      values: { fullName, email: req.body.email || '' }
    });
  }

  if (password.length < 8) {
    return renderSignup(res, {
      error: 'Password must be at least 8 characters long.',
      values: { fullName, email: req.body.email || '' }
    });
  }

  if (password !== confirmPassword) {
    return renderSignup(res, {
      error: 'Password and confirm password must match.',
      values: { fullName, email: req.body.email || '' }
    });
  }

  if (store.users.some(user => user.email === email)) {
    return renderSignup(res, {
      error: 'An account with that email already exists.',
      values: { fullName, email: req.body.email || '' }
    });
  }

  const passwordMeta = hashPassword(password);
  const user = {
    id: store.nextUserId++,
    fullName,
    email,
    passwordSalt: passwordMeta.salt,
    passwordHash: passwordMeta.hash,
    createdAt: new Date().toISOString()
  };

  const hasUnassignedEntries = store.incomeEntries.some(entry => !entry.userId) || store.expenseEntries.some(entry => !entry.userId);
  if (!store.users.length && hasUnassignedEntries) {
    store.incomeEntries = store.incomeEntries.map(entry => ({ ...entry, userId: user.id }));
    store.expenseEntries = store.expenseEntries.map(entry => ({ ...entry, userId: user.id }));
  }

  store.users.push(user);
  writeStore(store);
  setFlash(req, 'success', 'Account created. Log in to continue.');
  return res.redirect('/login');
});

app.get('/login', (req, res) => {
  if (getSessionUserId(req)) {
    return res.redirect('/dashboard');
  }
  return renderLogin(req, res);
});

app.post('/login', (req, res) => {
  const store = readStore();
  const email = normalizeEmail(req.body.email);
  const password = String(req.body.password || '');
  const user = store.users.find(candidate => candidate.email === email);

  if (!email || !password) {
    return renderLogin(req, res, {
      error: 'Email and password are required.',
      values: { email: req.body.email || '' }
    });
  }

  if (!user || !verifyPassword(password, user)) {
    return renderLogin(req, res, {
      error: 'Invalid email or password.',
      values: { email: req.body.email || '' }
    });
  }

  setUserSession(req, user);
  return res.redirect('/dashboard');
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

app.get('/dashboard', (req, res) => {
  const store = readStore();
  const userEntries = getReadableEntries(store, req);
  const data = buildDashboardViewModel(userEntries.incomeEntries, userEntries.expenseEntries);
  res.render('overview', { page: 'dashboard', data, money, flash: pullFlash(req) });
});

app.get('/income', (req, res) => {
  const store = readStore();
  const filters = getFilters(req.query);
  const filteredEntries = applyFilters(getReadableEntries(store, req).incomeEntries, filters);
  const data = buildIncomeViewModel(filteredEntries, filters);
  res.render('accounts', { page: 'income', data, money, flash: pullFlash(req), categoryOptions: INCOME_CATEGORIES });
});

app.get('/expense', (req, res) => {
  const store = readStore();
  const filters = getFilters(req.query);
  const filteredEntries = applyFilters(getReadableEntries(store, req).expenseEntries, filters);
  const data = buildExpenseViewModel(filteredEntries, filters);
  res.render('budgets', { page: 'expense', data, money, flash: pullFlash(req), categoryOptions: EXPENSE_CATEGORIES });
});

app.get('/settings', (req, res) => {
  const store = readStore();
  const userId = getDemoUserId(store, req);
  const user = store.users.find(item => item.id === userId);

  if (!user) {
    return res.render('settings', {
      page: 'settings',
      money,
      flash: pullFlash(req),
      values: {
        fullName: 'Expense Tracker Demo',
        email: 'demo@example.com'
      }
    });
  }

  return res.render('settings', {
    page: 'settings',
    money,
    flash: pullFlash(req),
    values: {
      fullName: user.fullName,
      email: user.email
    }
  });
});

app.post('/settings/profile', requireAuth, (req, res) => {
  const store = readStore();
  const userId = getSessionUserId(req);
  const fullName = String(req.body.fullName || '').trim();

  if (!fullName) {
    setFlash(req, 'error', 'Full name is required.');
    return res.redirect('/settings');
  }

  const user = store.users.find(item => item.id === userId);
  if (!user) {
    clearUserSession(req);
    return res.redirect('/login');
  }

  user.fullName = fullName;
  writeStore(store);
  setFlash(req, 'success', 'Profile updated successfully.');
  return res.redirect('/settings');
});

app.post('/settings/password', requireAuth, (req, res) => {
  const store = readStore();
  const userId = getSessionUserId(req);
  const currentPassword = String(req.body.currentPassword || '');
  const newPassword = String(req.body.newPassword || '');
  const confirmPassword = String(req.body.confirmPassword || '');
  const user = store.users.find(item => item.id === userId);

  if (!user) {
    clearUserSession(req);
    return res.redirect('/login');
  }

  if (!currentPassword || !newPassword || !confirmPassword) {
    setFlash(req, 'error', 'Please fill all password fields.');
    return res.redirect('/settings');
  }

  if (!verifyPassword(currentPassword, user)) {
    setFlash(req, 'error', 'Current password is incorrect.');
    return res.redirect('/settings');
  }

  if (newPassword.length < 8) {
    setFlash(req, 'error', 'New password must be at least 8 characters long.');
    return res.redirect('/settings');
  }

  if (newPassword !== confirmPassword) {
    setFlash(req, 'error', 'New password and confirm password must match.');
    return res.redirect('/settings');
  }

  const passwordMeta = hashPassword(newPassword);
  user.passwordSalt = passwordMeta.salt;
  user.passwordHash = passwordMeta.hash;
  writeStore(store);
  setFlash(req, 'success', 'Password updated successfully.');
  return res.redirect('/settings');
});

app.post('/income/add', requireAuth, (req, res) => {
  const store = readStore();
  const userId = getSessionUserId(req);
  const { icon, title, category, amount, date } = req.body;
  const parsedAmount = Number(amount);

  if (!title || !category || !date || Number.isNaN(parsedAmount) || parsedAmount <= 0) {
    setFlash(req, 'error', 'Please provide valid income details.');
    return res.redirect('/income');
  }

  store.incomeEntries.unshift({
    id: store.nextEntryId++,
    userId,
    title: String(title).trim(),
    category,
    date,
    amount: Math.abs(parsedAmount),
    icon: icon || '💼'
  });
  writeStore(store);
  setFlash(req, 'success', 'Income added successfully');
  return res.redirect('/income');
});

app.post('/income/edit/:id', requireAuth, (req, res) => {
  const store = readStore();
  const userId = getSessionUserId(req);
  const id = Number(req.params.id);
  const { icon, title, category, amount, date } = req.body;
  const parsedAmount = Number(amount);

  if (!title || !category || !date || Number.isNaN(parsedAmount) || parsedAmount <= 0) {
    setFlash(req, 'error', 'Please provide valid income details.');
    return res.redirect('/income');
  }

  const updated = updateEntry(store.incomeEntries, id, userId, existing => ({
    ...existing,
    title: String(title).trim(),
    category,
    date,
    amount: Math.abs(parsedAmount),
    icon: icon || existing.icon || '💼'
  }));

  if (!updated) {
    setFlash(req, 'error', 'Income entry not found.');
    return res.redirect('/income');
  }

  writeStore(store);
  setFlash(req, 'success', 'Income updated successfully');
  return res.redirect('/income');
});

app.post('/income/delete/:id', requireAuth, (req, res) => {
  const store = readStore();
  const userId = getSessionUserId(req);
  const id = Number(req.params.id);
  store.incomeEntries = store.incomeEntries.filter(item => !(item.id === id && item.userId === userId));
  writeStore(store);
  setFlash(req, 'success', 'Income removed successfully');
  return res.redirect('/income');
});

app.post('/expense/add', requireAuth, (req, res) => {
  const store = readStore();
  const userId = getSessionUserId(req);
  const { icon, title, category, amount, date } = req.body;
  const parsedAmount = Number(amount);

  if (!title || !category || !date || Number.isNaN(parsedAmount) || parsedAmount <= 0) {
    setFlash(req, 'error', 'Please provide valid expense details.');
    return res.redirect('/expense');
  }

  store.expenseEntries.unshift({
    id: store.nextEntryId++,
    userId,
    title: String(title).trim(),
    category,
    date,
    amount: -Math.abs(parsedAmount),
    icon: icon || '🧾'
  });
  writeStore(store);
  setFlash(req, 'success', 'Expense added successfully');
  return res.redirect('/expense');
});

app.post('/expense/edit/:id', requireAuth, (req, res) => {
  const store = readStore();
  const userId = getSessionUserId(req);
  const id = Number(req.params.id);
  const { icon, title, category, amount, date } = req.body;
  const parsedAmount = Number(amount);

  if (!title || !category || !date || Number.isNaN(parsedAmount) || parsedAmount <= 0) {
    setFlash(req, 'error', 'Please provide valid expense details.');
    return res.redirect('/expense');
  }

  const updated = updateEntry(store.expenseEntries, id, userId, existing => ({
    ...existing,
    title: String(title).trim(),
    category,
    date,
    amount: -Math.abs(parsedAmount),
    icon: icon || existing.icon || '🧾'
  }));

  if (!updated) {
    setFlash(req, 'error', 'Expense entry not found.');
    return res.redirect('/expense');
  }

  writeStore(store);
  setFlash(req, 'success', 'Expense updated successfully');
  return res.redirect('/expense');
});

app.post('/expense/delete/:id', requireAuth, (req, res) => {
  const store = readStore();
  const userId = getSessionUserId(req);
  const id = Number(req.params.id);
  store.expenseEntries = store.expenseEntries.filter(item => !(item.id === id && item.userId === userId));
  writeStore(store);
  setFlash(req, 'success', 'Expense removed successfully');
  return res.redirect('/expense');
});

app.get('/income/download', requireAuth, (req, res) => {
  const store = readStore();
  const userId = getSessionUserId(req);
  const filters = getFilters(req.query);
  const filteredEntries = applyFilters(getUserEntries(store, userId).incomeEntries, filters);
  const csv = toCsv(
    filteredEntries.map(item => [item.title, item.category, Math.abs(item.amount), item.date, item.icon]),
    ['Source', 'Category', 'Amount', 'Date', 'Icon']
  );

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="income.csv"');
  return res.send(csv);
});

app.get('/expense/download', requireAuth, (req, res) => {
  const store = readStore();
  const userId = getSessionUserId(req);
  const filters = getFilters(req.query);
  const filteredEntries = applyFilters(getUserEntries(store, userId).expenseEntries, filters);
  const csv = toCsv(
    filteredEntries.map(item => [item.title, item.category, Math.abs(item.amount), item.date, item.icon]),
    ['Title', 'Category', 'Amount', 'Date', 'Icon']
  );

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="expense.csv"');
  return res.send(csv);
});

app.get('/transactions', (req, res) => {
  const store = readStore();
  const data = buildExpenseViewModel(getReadableEntries(store, req).expenseEntries, getFilters({}));
  res.render('transactions', { page: 'expense', data, money, flash: pullFlash(req) });
});

app.get('/charts', (req, res) => {
  const store = readStore();
  const userEntries = getReadableEntries(store, req);
  const data = buildDashboardViewModel(userEntries.incomeEntries, userEntries.expenseEntries);
  res.render('charts', { page: 'dashboard', data, money, flash: pullFlash(req) });
});

app.listen(4001, () => {
  console.log(`Expense Tracker running at http://localhost:${4001}`);
});
