// הגדרות מערכות מידות לפי סוג פריט
// כל סכמת מידות מגדירה כיצד נבחרות המידות עבור פריט מסוים.

const WOMEN_LETTERS = ['Y', 'XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'];
const MEN_LETTERS = ['S', 'M', 'L', 'XL', '2XL', '3XL'];
const GENERIC_LETTERS = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'];

// המרה מאותיות למספרים (היקף מותן בערך) עבור מכנסיים
const PANTS_LETTER_TO_NUMBER = {
  Y: '26',
  XS: '28',
  S: '30',
  M: '32',
  L: '34',
  XL: '36',
  '2XL': '38',
  '3XL': '40',
};

// מספרי מכנסיים נפוצים (היקף מותן באינצ'ים)
const PANTS_NUMBERS = ['26', '28', '30', '32', '34', '36', '38', '40', '42', '44'];

// מידות מספריות לג'קטים / מעילים / סופטשל (מידה אירופאית)
const JACKET_NUMBERS = ['44', '46', '48', '50', '52', '54', '56', '58', '60'];

// טווחי מידות נעליים למבוגרים (מידה אירופאית EU)
function range(from, to) {
  const out = [];
  for (let i = from; i <= to; i++) out.push(String(i));
  return out;
}
const SHOES_WOMEN = range(35, 43);
const SHOES_MEN = range(39, 48);

// יצרני נעליים נפוצים (כולל בלנסטון). זהו רק רשימת ברירת מחדל לנוחות – ניתן להזין יצרן חופשי.
const SHOE_MANUFACTURERS = ['Blundstone', 'Caterpillar', 'Salomon', 'Timberland', 'Dr. Martens', 'אחר'];

// הגדרת כל הסכמות. gendered = האם המידה תלויה במין.
export const SIZE_SCHEMES = {
  gender_letters: {
    label: 'אותיות לפי מין (חולצות)',
    gendered: true,
    manufacturer: false,
    options: { men: MEN_LETTERS, women: WOMEN_LETTERS },
  },
  pants: {
    label: 'מכנסיים – אותיות עם המרה למספרים',
    gendered: true,
    manufacturer: false,
    options: { men: MEN_LETTERS, women: WOMEN_LETTERS },
    numericMap: PANTS_LETTER_TO_NUMBER,
    numericOptions: PANTS_NUMBERS,
  },
  shoes: {
    label: 'נעליים – מספרים לפי יצרן ומין',
    gendered: true,
    manufacturer: true,
    manufacturers: SHOE_MANUFACTURERS,
    options: { men: SHOES_MEN, women: SHOES_WOMEN },
  },
  letters_numbers: {
    label: 'אותיות או מספרים (ג\'קטים / סופטשל / מעילים)',
    gendered: false,
    manufacturer: false,
    options: { all: [...GENERIC_LETTERS, ...JACKET_NUMBERS] },
  },
  letters: {
    label: 'אותיות בלבד (XS–3XL)',
    gendered: false,
    manufacturer: false,
    options: { all: GENERIC_LETTERS },
  },
  numbers: {
    label: 'מספרים בלבד',
    gendered: false,
    manufacturer: false,
    options: { all: range(1, 60) },
  },
  none: {
    label: 'ללא מידה (עניבות)',
    gendered: false,
    manufacturer: false,
    options: { all: [''] },
  },
};

// סוגי פריטים שמוקמים אוטומטית עבור כל חברת ניהול חדשה
export const DEFAULT_ITEM_TYPES = [
  { name: 'חולצות', size_scheme: 'gender_letters' },
  { name: 'מכנסיים', size_scheme: 'pants' },
  { name: 'נעליים', size_scheme: 'shoes' },
  { name: 'עניבות', size_scheme: 'none' },
  { name: "ג'קטים", size_scheme: 'letters_numbers' },
  { name: 'סופטשלים', size_scheme: 'letters_numbers' },
  { name: 'מעילי דובון', size_scheme: 'letters_numbers' },
];

// החזרת רשימת מידות אפשריות לסכמה ומין נתונים
export function sizeOptions(scheme, gender) {
  const def = SIZE_SCHEMES[scheme];
  if (!def) return [];
  if (def.gendered) {
    return def.options[gender] || [];
  }
  return def.options.all || [];
}

// בדיקת תקינות מין מול סכמה
export function isValidScheme(scheme) {
  return Object.prototype.hasOwnProperty.call(SIZE_SCHEMES, scheme);
}
