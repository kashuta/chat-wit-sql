import React, { useState } from 'react';

type FilterConfig = {
  type?: string;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
  amountMin?: number;
  amountMax?: number;
  [key: string]: any;
};

type TransactionFiltersProps = {
  onFilterChange: (filters: FilterConfig) => void;
  availableTypes?: string[];
  availableStatuses?: string[];
  initialFilters?: FilterConfig;
};

const TransactionFilters: React.FC<TransactionFiltersProps> = ({
  onFilterChange,
  availableTypes = [],
  availableStatuses = [],
  initialFilters = {}
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [filters, setFilters] = useState<FilterConfig>(initialFilters);

  const handleFilterChange = (key: string, value: any) => {
    const newFilters = { ...filters, [key]: value };
    // If value is empty string or undefined, remove the filter
    if (value === '' || value === undefined) {
      delete newFilters[key];
    }
    
    setFilters(newFilters);
    onFilterChange(newFilters);
  };

  const clearFilters = () => {
    setFilters({});
    onFilterChange({});
  };

  // Format field name from camel case to title case
  const formatFieldName = (field: string): string => {
    return field
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, (str) => str.toUpperCase());
  };

  return (
    <div className="transaction-filters">
      <div className="filters-header" onClick={() => setIsExpanded(!isExpanded)}>
        <h3 className="filters-title">Filters</h3>
        <span className="toggle-indicator">{isExpanded ? '▲' : '▼'}</span>
      </div>
      
      {isExpanded && (
        <div className="filters-content">
          <div className="filter-row">
            <div className="filter-field">
              <label htmlFor="type-filter">Type:</label>
              <select 
                id="type-filter"
                value={filters.type || ''}
                onChange={(e) => handleFilterChange('type', e.target.value)}
                className="filter-select"
              >
                <option value="">All Types</option>
                {availableTypes.map(type => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>
            
            <div className="filter-field">
              <label htmlFor="status-filter">Status:</label>
              <select 
                id="status-filter"
                value={filters.status || ''}
                onChange={(e) => handleFilterChange('status', e.target.value)}
                className="filter-select"
              >
                <option value="">All Statuses</option>
                {availableStatuses.map(status => (
                  <option key={status} value={status}>{status}</option>
                ))}
              </select>
            </div>
          </div>
          
          <div className="filter-row">
            <div className="filter-field">
              <label htmlFor="date-from">From Date:</label>
              <input 
                id="date-from"
                type="date"
                value={filters.dateFrom || ''}
                onChange={(e) => handleFilterChange('dateFrom', e.target.value)}
                className="filter-input"
              />
            </div>
            
            <div className="filter-field">
              <label htmlFor="date-to">To Date:</label>
              <input 
                id="date-to"
                type="date"
                value={filters.dateTo || ''}
                onChange={(e) => handleFilterChange('dateTo', e.target.value)}
                className="filter-input"
              />
            </div>
          </div>
          
          <div className="filter-row">
            <div className="filter-field">
              <label htmlFor="amount-min">Min Amount:</label>
              <input 
                id="amount-min"
                type="number"
                value={filters.amountMin || ''}
                onChange={(e) => handleFilterChange('amountMin', e.target.value ? Number(e.target.value) : '')}
                className="filter-input"
              />
            </div>
            
            <div className="filter-field">
              <label htmlFor="amount-max">Max Amount:</label>
              <input 
                id="amount-max"
                type="number"
                value={filters.amountMax || ''}
                onChange={(e) => handleFilterChange('amountMax', e.target.value ? Number(e.target.value) : '')}
                className="filter-input"
              />
            </div>
          </div>
          
          {/* Display active filters */}
          {Object.keys(filters).length > 0 && (
            <div className="active-filters">
              <div className="active-filters-header">
                <h4>Active Filters</h4>
                <button 
                  onClick={clearFilters}
                  className="clear-filters-button"
                >
                  Clear All
                </button>
              </div>
              <div className="filter-tags">
                {Object.entries(filters).map(([key, value]) => (
                  <div key={key} className="filter-tag">
                    <span className="tag-label">{formatFieldName(key)}:</span>
                    <span className="tag-value">{value}</span>
                    <button 
                      onClick={() => handleFilterChange(key, '')}
                      className="remove-tag"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default TransactionFilters; 