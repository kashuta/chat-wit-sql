import React, { useState } from 'react';

type Transaction = {
  id?: number | string;
  date?: string;
  timestamp?: string;
  time?: string;
  type?: string;
  amount?: number;
  currency?: string;
  status?: string;
  method?: string;
  source?: string;
  [key: string]: any;
};

type TransactionTableProps = {
  transactions: Transaction[];
  pageSize?: number;
};

const TransactionTable: React.FC<TransactionTableProps> = ({ 
  transactions, 
  pageSize = 10 
}) => {
  const [currentPage, setCurrentPage] = useState(1);
  const [sortField, setSortField] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  if (!transactions || transactions.length === 0) {
    return <div className="no-transactions">No transactions found</div>;
  }

  // Get all possible fields from transactions to create table headers
  const allFields = new Set<string>();
  transactions.forEach(transaction => {
    Object.keys(transaction).forEach(key => allFields.add(key));
  });

  // Prioritize common fields and hide certain system fields
  const priorityFields = ['id', 'date', 'timestamp', 'time', 'type', 'amount', 'currency', 'status', 'method', 'source'];
  const hiddenFields = ['_id', '__v', 'userId', 'user_id', 'createdAt', 'updatedAt'];
  
  const visibleFields = [...priorityFields.filter(field => allFields.has(field)), 
    ...[...allFields].filter(field => 
      !priorityFields.includes(field) && !hiddenFields.includes(field)
    )];

  // Sorting logic
  const sortedTransactions = [...transactions].sort((a, b) => {
    if (!sortField) return 0;
    
    const aValue = a[sortField];
    const bValue = b[sortField];
    
    if (aValue === undefined) return 1;
    if (bValue === undefined) return -1;
    
    if (typeof aValue === 'number' && typeof bValue === 'number') {
      return sortDirection === 'asc' ? aValue - bValue : bValue - aValue;
    }
    
    const aString = String(aValue).toLowerCase();
    const bString = String(bValue).toLowerCase();
    
    return sortDirection === 'asc' 
      ? aString.localeCompare(bString) 
      : bString.localeCompare(aString);
  });

  // Pagination logic
  const totalPages = Math.ceil(sortedTransactions.length / pageSize);
  const startIndex = (currentPage - 1) * pageSize;
  const paginatedTransactions = sortedTransactions.slice(startIndex, startIndex + pageSize);

  // Handle sort change
  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  // Format table header from field name
  const formatHeader = (field: string): string => {
    return field
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, (str) => str.toUpperCase())
      .replace(/_/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2');
  };

  // Format cell value based on field type
  const formatCellValue = (field: string, value: any): string => {
    if (value === null || value === undefined) return 'N/A';
    
    // Format date fields
    if (['date', 'timestamp', 'time', 'createdAt', 'updatedAt'].includes(field) && value) {
      try {
        const date = new Date(value);
        if (!isNaN(date.getTime())) {
          return new Intl.DateTimeFormat('en-US', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
          }).format(date);
        }
      } catch (e) {
        // If date parsing fails, return the original value
      }
    }
    
    // Format amount with currency if available
    if (field === 'amount') {
      const transaction = transactions.find(t => t[field] === value);
      const currency = transaction?.currency || '';
      return `${new Intl.NumberFormat('en-US').format(value)} ${currency}`;
    }
    
    if (typeof value === 'object') {
      return JSON.stringify(value);
    }
    
    return String(value);
  };

  // Get appropriate CSS class based on transaction type or status
  const getTypeClass = (transaction: Transaction): string => {
    const type = transaction.type?.toString().toUpperCase();
    
    if (type?.includes('DEPOSIT') || type?.includes('INCOME') || type?.includes('WIN')) {
      return 'transaction-positive';
    }
    
    if (type?.includes('WITHDRAW') || type?.includes('OUTCOME') || type?.includes('LOSS')) {
      return 'transaction-negative';
    }
    
    return '';
  };

  const getStatusClass = (status?: string): string => {
    if (!status) return '';
    
    status = status.toUpperCase();
    
    if (['APPROVED', 'COMPLETED', 'SUCCESS'].includes(status)) {
      return 'status-positive';
    }
    
    if (['PENDING', 'PROCESSING'].includes(status)) {
      return 'status-warning';
    }
    
    if (['REJECTED', 'FAILED', 'ERROR'].includes(status)) {
      return 'status-negative';
    }
    
    return '';
  };

  return (
    <div className="transaction-table-container">
      <h3 className="table-title">Transactions</h3>
      <div className="table-responsive">
        <table className="transaction-table">
          <thead>
            <tr>
              {visibleFields.map(field => (
                <th key={field} onClick={() => handleSort(field)}>
                  {formatHeader(field)}
                  {sortField === field && (
                    <span className="sort-indicator">
                      {sortDirection === 'asc' ? ' ↑' : ' ↓'}
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paginatedTransactions.map((transaction, index) => (
              <tr 
                key={`${transaction.id || index}`}
                className={getTypeClass(transaction)}
              >
                {visibleFields.map(field => (
                  <td key={field} className={field === 'status' ? getStatusClass(transaction.status?.toString()) : ''}>
                    {formatCellValue(field, transaction[field])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      
      {totalPages > 1 && (
        <div className="pagination">
          <button 
            onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
            disabled={currentPage === 1}
            className="pagination-button"
          >
            Previous
          </button>
          <span className="page-info">
            Page {currentPage} of {totalPages}
          </span>
          <button 
            onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
            disabled={currentPage === totalPages}
            className="pagination-button"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
};

export default TransactionTable; 