import React from 'react';

type BalanceDisplayProps = {
  balance: number;
  currency?: string;
  previousBalance?: number;
};

const BalanceDisplay: React.FC<BalanceDisplayProps> = ({ 
  balance, 
  currency = 'TJS', 
  previousBalance 
}) => {
  const hasChanged = previousBalance !== undefined && previousBalance !== balance;
  const isPositiveChange = hasChanged && balance > previousBalance;
  
  // Format the balance with thousand separators
  const formatBalance = (value: number): string => {
    return new Intl.NumberFormat('en-US').format(value);
  };

  return (
    <div className="balance-card">
      <h3 className="card-title">Current Balance</h3>
      <div className="balance-content">
        <div className="balance-amount">
          {formatBalance(balance)} {currency}
          {hasChanged && (
            <span className={`balance-change ${isPositiveChange ? 'positive' : 'negative'}`}>
              {isPositiveChange ? '↑' : '↓'}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

export default BalanceDisplay; 