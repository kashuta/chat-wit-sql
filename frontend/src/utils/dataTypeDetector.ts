/**
 * Data type detection utility
 */

/**
 * Detects what types of data are present in a query result
 */
export const detectDataTypes = (data: Record<string, unknown>): DataTypeFlags => {
  // Initialize with all flags false
  const flags: DataTypeFlags = {
    hasUserInfo: false,
    hasBalance: false,
    hasTransactions: false,
    hasLogs: false
  };
  
  // Check if data has user information
  flags.hasUserInfo = hasUserData(data);
  
  // Check if data has balance information
  flags.hasBalance = hasBalanceData(data);
  
  // Check if data has transaction information
  flags.hasTransactions = hasTransactionData(data);
  
  // Check if data has log information
  flags.hasLogs = hasLogData(data);
  
  return flags;
};

/**
 * Data type flags interface
 */
export interface DataTypeFlags {
  hasUserInfo: boolean;
  hasBalance: boolean;
  hasTransactions: boolean;
  hasLogs: boolean;
}

/**
 * Checks if the data contains user information
 */
const hasUserData = (data: Record<string, unknown>): boolean => {
  // Look for common user fields in the data
  const userFields = ['email', 'username', 'firstName', 'lastName', 'name', 'user_id', 'userId', 'id'];
  
  for (const field of userFields) {
    if (data[field] !== undefined) return true;
  }
  
  // Check in service-specific fields
  const services = ['pam', 'user', 'kyc', 'customer'];
  for (const service of services) {
    const serviceData = data[service] as Record<string, unknown>;
    if (serviceData && typeof serviceData === 'object') {
      for (const field of userFields) {
        if (serviceData[field] !== undefined) return true;
      }
    }
  }
  
  return false;
};

/**
 * Checks if the data contains balance information
 */
const hasBalanceData = (data: Record<string, unknown>): boolean => {
  // Look for balance fields in the data
  if (typeof data.balance === 'number' || typeof data.amount === 'number') {
    return true;
  }
  
  // Check wallet service
  if (data.wallet && typeof data.wallet === 'object') {
    const wallet = data.wallet as Record<string, unknown>;
    return typeof wallet.balance === 'number' || typeof wallet.amount === 'number';
  }
  
  return false;
};

/**
 * Checks if the data contains transaction information
 */
const hasTransactionData = (data: Record<string, unknown>): boolean => {
  // Check wallet service for transactions
  if (data.wallet && typeof data.wallet === 'object') {
    const wallet = data.wallet as Record<string, unknown>;
    return Array.isArray(wallet.transactions) && wallet.transactions.length > 0;
  }
  
  // Check financial-history service
  if (data['financial-history'] && Array.isArray(data['financial-history'])) {
    return data['financial-history'].length > 0;
  }
  
  // Check transactions in root
  if (data.transactions && Array.isArray(data.transactions)) {
    return data.transactions.length > 0;
  }
  
  return false;
};

/**
 * Checks if the data contains log information
 */
const hasLogData = (data: Record<string, unknown>): boolean => {
  // Check for logs in data
  if (data.logs && Array.isArray(data.logs)) {
    return data.logs.length > 0;
  }
  
  // Check for events in data
  if (data.events && Array.isArray(data.events)) {
    return data.events.length > 0;
  }
  
  return false;
}; 