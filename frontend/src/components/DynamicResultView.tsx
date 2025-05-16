import React from 'react';
import UserInfoCard from './user/UserInfoCard';
import BalanceDisplay from './user/BalanceDisplay';
import AccountStatus from './user/AccountStatus';
import TransactionTable from './transactions/TransactionTable';
import LogViewer, { LogEntry } from './execution/LogViewer';
import { useLanguage } from '../contexts/LanguageContext';
import { DataTypeFlags } from '../utils/dataTypeDetector';

interface DynamicResultViewProps {
  result: any;
  processedData: any;
  logs: LogEntry[];
  showSql: boolean;
  onToggleSql: () => void;
}

const DynamicResultView: React.FC<DynamicResultViewProps> = ({ 
  result, 
  processedData, 
  logs,
  showSql,
  onToggleSql
}) => {
  const { t } = useLanguage();
  
  // Get data type flags, defaulting to false for all
  const dataTypes: DataTypeFlags = result.dataTypes || {
    hasUserInfo: false,
    hasBalance: false,
    hasTransactions: false,
    hasLogs: false
  };
  
  // Check if each component should be shown
  const showUserInfo = dataTypes.hasUserInfo && Object.keys(processedData.userInfo || {}).length > 0;
  const showBalance = dataTypes.hasBalance && processedData.balanceInfo?.balance !== undefined;
  const showAccountStatus = dataTypes.hasUserInfo && Object.keys(processedData.accountStatus || {}).length > 0;
  const showTransactions = dataTypes.hasTransactions && processedData.transactions?.length > 0;
  const showLogs = dataTypes.hasLogs || logs.length > 0;
  
  return (
    <div className="result-container">
      {/* User Information Section */}
      {(showUserInfo || showBalance || showAccountStatus) && (
        <div className="user-info-section">
          {showUserInfo && <UserInfoCard userData={processedData.userInfo} />}
          {showBalance && (
            <BalanceDisplay 
              balance={processedData.balanceInfo.balance} 
              currency={processedData.balanceInfo.currency}
              previousBalance={processedData.balanceInfo.previousBalance}
            />
          )}
          {showAccountStatus && <AccountStatus {...processedData.accountStatus} />}
        </div>
      )}
      
      {/* Explanation Section - Always shown */}
      <div className="explanation">
        <h2>{t.explanationTitle}</h2>
        <p>{result.explanation}</p>
        <div className="confidence">
          {t.confidenceLabel}: {(result.confidence * 100).toFixed(0)}%
        </div>
        <div className="show-sql-toggle">
          <button 
            onClick={onToggleSql}
            className="toggle-button"
          >
            {showSql ? 'Hide SQL Query' : 'Show SQL Query'}
          </button>
        </div>
      </div>
      
      {/* SQL Query Section (Togglable) */}
      {showSql && result.sql && (
        <div className="sql-query">
          <h3>{t.sqlQueryTitle}</h3>
          <pre>{result.sql}</pre>
        </div>
      )}
      
      {/* Transaction Section */}
      {showTransactions && (
        <div className="transactions-section">
          <h3>Transactions</h3>
          <TransactionTable transactions={processedData.transactions} />
        </div>
      )}
      
      {/* Logs Section */}
      {showLogs && (
        <div className="logs-section">
          <h3>Execution Logs</h3>
          <LogViewer logs={logs} />
        </div>
      )}
    </div>
  );
};

export default DynamicResultView; 