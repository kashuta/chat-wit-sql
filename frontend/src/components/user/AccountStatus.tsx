import React from 'react';

type AccountStatusProps = {
  kycStatus?: 'CONFIRMED' | 'PENDING' | 'REJECTED' | string;
  isBlocked?: boolean;
  accountStatus?: 'ACTIVE' | 'SUSPENDED' | 'CLOSED' | string;
  [key: string]: any;
};

const AccountStatus: React.FC<AccountStatusProps> = ({
  kycStatus,
  isBlocked = false,
  accountStatus = 'ACTIVE',
  ...otherStatuses
}) => {
  const getStatusColor = (status?: string, isNegative = false): string => {
    if (!status) return 'status-neutral';
    
    status = status.toUpperCase();
    
    if (isNegative) {
      return status === 'TRUE' || status === 'YES' ? 'status-negative' : 'status-positive';
    }
    
    if (status === 'CONFIRMED' || status === 'ACTIVE' || status === 'APPROVED') {
      return 'status-positive';
    } else if (status === 'PENDING' || status === 'PROCESSING') {
      return 'status-warning';
    } else if (status === 'REJECTED' || status === 'CLOSED' || status === 'SUSPENDED') {
      return 'status-negative';
    }
    
    return 'status-neutral';
  };

  const formatLabel = (key: string): string => {
    return key
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, (str) => str.toUpperCase())
      .replace(/([a-z])([A-Z])/g, '$1 $2');
  };

  return (
    <div className="account-status-card">
      <h3 className="card-title">Account Status</h3>
      <div className="status-content">
        {kycStatus && (
          <div className="status-row">
            <span className="status-label">KYC:</span>
            <span className={`status-indicator ${getStatusColor(kycStatus)}`}>
              {kycStatus}
            </span>
          </div>
        )}
        
        <div className="status-row">
          <span className="status-label">Blocked:</span>
          <span className={`status-indicator ${getStatusColor(String(isBlocked), true)}`}>
            {isBlocked ? 'Yes' : 'No'}
          </span>
        </div>
        
        <div className="status-row">
          <span className="status-label">Status:</span>
          <span className={`status-indicator ${getStatusColor(accountStatus)}`}>
            {accountStatus}
          </span>
        </div>
        
        {Object.entries(otherStatuses).map(([key, value]) => (
          <div key={key} className="status-row">
            <span className="status-label">{formatLabel(key)}:</span>
            <span className={`status-indicator ${getStatusColor(String(value))}`}>
              {typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default AccountStatus; 