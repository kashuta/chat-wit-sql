/**
 * Formats a number with thousand separators
 */
export const formatNumber = (value: number): string => {
  return new Intl.NumberFormat('en-US').format(value);
};

/**
 * Formats a date with specified locale and options
 */
export const formatDate = (
  date: Date | string | number,
  options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }
): string => {
  try {
    const dateObj = date instanceof Date ? date : new Date(date);
    return new Intl.DateTimeFormat('en-US', options).format(dateObj);
  } catch (e) {
    return String(date);
  }
};

/**
 * Truncates text to specified length with ellipsis
 */
export const truncateText = (text: string, maxLength: number): string => {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
};

/**
 * Formats a currency amount with symbol
 */
export const formatCurrency = (
  amount: number,
  currency = 'TJS',
  locale = 'en-US'
): string => {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amount);
};

/**
 * Converts camelCase or snake_case to Title Case
 */
export const formatFieldName = (field: string): string => {
  return field
    .replace(/([A-Z])/g, ' $1')
    .replace(/_/g, ' ')
    .replace(/^./, (str) => str.toUpperCase())
    .trim();
};

/**
 * Extracts a user-friendly name from a database field
 */
export const getUserFriendlyName = (fieldName: string): string => {
  // Remove common prefixes
  const withoutPrefix = fieldName
    .replace(/^user_/i, '')
    .replace(/^customer_/i, '')
    .replace(/^account_/i, '');
  
  return formatFieldName(withoutPrefix);
};

/**
 * Safely extracts a value from an object with optional nesting using dot notation
 */
export const getNestedValue = (obj: any, path: string, defaultValue: any = null): any => {
  try {
    const keys = path.split('.');
    let current = obj;
    
    for (const key of keys) {
      if (current === null || current === undefined) {
        return defaultValue;
      }
      current = current[key];
    }
    
    return current !== undefined ? current : defaultValue;
  } catch (e) {
    return defaultValue;
  }
}; 