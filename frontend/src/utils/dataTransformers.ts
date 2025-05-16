import { formatDate } from './formatters';

/**
 * Extracts user information from a raw data object
 */
export const extractUserInfo = (data: Record<string, any>): Record<string, any> => {
  const userInfo: Record<string, any> = {};
  
  // Try to find user data in various services
  const possibleServices = ['pam', 'user', 'kyc', 'customer'];
  let userData: Record<string, any> | null = null;
  
  // Check each possible service for user data
  for (const service of possibleServices) {
    if (data[service] && typeof data[service] === 'object') {
      userData = data[service];
      break;
    }
  }
  
  // If no service-specific data found, try to extract from root
  if (!userData) {
    userData = data;
  }
  
  // Extract common user fields
  const userFields = [
    'id', 'user_id', 'userId', 'username', 'name', 'firstName', 'first_name',
    'lastName', 'last_name', 'email', 'phone', 'phoneNumber', 'phone_number',
    'address', 'city', 'country', 'status', 'registrationDate', 'registration_date',
    'created_at', 'createdAt', 'kycStatus', 'kyc_status'
  ];
  
  userFields.forEach(field => {
    if (userData && userData[field] !== undefined) {
      // Format dates
      if (field.toLowerCase().includes('date') || field === 'createdAt' || field === 'created_at') {
        try {
          userInfo[field] = formatDate(userData[field]);
        } catch (e) {
          userInfo[field] = userData[field];
        }
      } else {
        userInfo[field] = userData[field];
      }
    }
  });
  
  return userInfo;
};

/**
 * Extracts balance information from a raw data object
 */
export const extractBalanceInfo = (data: Record<string, any>): { 
  balance: number;
  currency?: string;
  previousBalance?: number;
} => {
  // Default values
  let balance = 0;
  let currency: string | undefined;
  let previousBalance: number | undefined;
  
  // Try to find balance data in wallet service
  if (data.wallet && typeof data.wallet === 'object') {
    const walletData = data.wallet;
    
    // Extract balance
    if (typeof walletData.balance === 'number') {
      balance = walletData.balance;
    } else if (typeof walletData.amount === 'number') {
      balance = walletData.amount;
    }
    
    // Extract currency
    if (typeof walletData.currency === 'string') {
      currency = walletData.currency;
    }
    
    // Extract previous balance if available
    if (typeof walletData.previousBalance === 'number') {
      previousBalance = walletData.previousBalance;
    }
  } else {
    // Try to find balance in root data
    if (typeof data.balance === 'number') {
      balance = data.balance;
    } else if (typeof data.amount === 'number') {
      balance = data.amount;
    }
    
    // Extract currency
    if (typeof data.currency === 'string') {
      currency = data.currency;
    }
  }
  
  return { balance, currency, previousBalance };
};

/**
 * Extracts transaction information from a raw data object
 */
export const extractTransactions = (data: Record<string, any>): any[] => {
  let transactions: any[] = [];
  
  // Check wallet service for transactions
  if (data.wallet && Array.isArray(data.wallet.transactions)) {
    transactions = [...data.wallet.transactions];
  } 
  // Check financial-history service
  else if (data['financial-history'] && Array.isArray(data['financial-history'])) {
    transactions = [...data['financial-history']];
  }
  // Check transactions in root
  else if (data.transactions && Array.isArray(data.transactions)) {
    transactions = [...data.transactions];
  }
  
  // Normalize transaction fields
  return transactions.map(tx => {
    // Make sure dates are formatted consistently
    if (tx.date) {
      try {
        tx.date = formatDate(tx.date);
      } catch (e) {
        // Keep original if parsing fails
      }
    }
    
    if (tx.timestamp) {
      try {
        tx.timestamp = formatDate(tx.timestamp);
      } catch (e) {
        // Keep original if parsing fails
      }
    }
    
    return tx;
  });
};

/**
 * Extracts account status information from a raw data object
 */
export const extractAccountStatus = (data: Record<string, any>): Record<string, any> => {
  const statusInfo: Record<string, any> = {};
  
  // Try to find status data in pam service
  if (data.pam && typeof data.pam === 'object') {
    const pamData = data.pam;
    
    // Extract account status
    if (pamData.status) {
      statusInfo.accountStatus = pamData.status;
    }
    
    // Extract blocked status
    if (typeof pamData.isBlocked === 'boolean') {
      statusInfo.isBlocked = pamData.isBlocked;
    } else if (typeof pamData.blocked === 'boolean') {
      statusInfo.isBlocked = pamData.blocked;
    }
  }
  
  // Try to find KYC status in kyc service
  if (data.kyc && typeof data.kyc === 'object') {
    if (data.kyc.status) {
      statusInfo.kycStatus = data.kyc.status;
    }
  }
  
  // If no service-specific data found, try to extract from root
  if (Object.keys(statusInfo).length === 0) {
    if (data.status) {
      statusInfo.accountStatus = data.status;
    }
    
    if (typeof data.isBlocked === 'boolean') {
      statusInfo.isBlocked = data.isBlocked;
    } else if (typeof data.blocked === 'boolean') {
      statusInfo.isBlocked = data.blocked;
    }
    
    if (data.kycStatus) {
      statusInfo.kycStatus = data.kycStatus;
    }
  }
  
  return statusInfo;
};

/**
 * Process a raw query result into a structured format for UI display
 */
export const processQueryResult = (result: Record<string, any>): {
  userInfo: Record<string, any>;
  balanceInfo: { 
    balance: number;
    currency?: string;
    previousBalance?: number;
  };
  transactions: any[];
  accountStatus: Record<string, any>;
} => {
  return {
    userInfo: extractUserInfo(result.data || {}),
    balanceInfo: extractBalanceInfo(result.data || {}),
    transactions: extractTransactions(result.data || {}),
    accountStatus: extractAccountStatus(result.data || {})
  };
}; 