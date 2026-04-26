import { useState } from 'react'
import { generateExportHTML, exportToPDF, exportAsText, downloadText } from '../lib/exportNotes'

export default function NotesExportModal({ isOpen, onClose, sessions, patientName, therapistName }) {
  const [exportFormat, setExportFormat] = useState('pdf') // 'pdf' or 'text'
  const [isExporting, setIsExporting] = useState(false)
  const [dateRange, setDateRange] = useState('all') // 'all', 'year', 'custom'
  const [customStartDate, setCustomStartDate] = useState('')
  const [customEndDate, setCustomEndDate] = useState('')
  const [error, setError] = useState('')

  if (!isOpen) return null

  // Filter sessions based on date range
  const getFilteredSessions = () => {
    if (!sessions || sessions.length === 0) return []

    if (dateRange === 'all') {
      return sessions
    }

    if (dateRange === 'year') {
      const oneYearAgo = new Date()
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)
      return sessions.filter(s => new Date(s.session_date) >= oneYearAgo)
    }

    if (dateRange === 'custom' && customStartDate && customEndDate) {
      const start = new Date(customStartDate)
      const end = new Date(customEndDate)
      end.setHours(23, 59, 59, 999)
      return sessions.filter(s => {
        const sessionDate = new Date(s.session_date)
        return sessionDate >= start && sessionDate <= end
      })
    }

    return sessions
  }

  const filteredSessions = getFilteredSessions()

  const handleExport = async () => {
    setError('')
    if (filteredSessions.length === 0) {
      setError('No sessions to export with the selected date range.')
      return
    }

    setIsExporting(true)

    try {
      if (exportFormat === 'pdf') {
        const dateRangeLabel = dateRange === 'year' ? 'Last 12 months' : dateRange === 'custom' ? `${customStartDate} to ${customEndDate}` : null
        const htmlContent = generateExportHTML(filteredSessions, patientName, therapistName, dateRangeLabel)
        await exportToPDF(htmlContent, `${patientName}-notes.pdf`)
      } else {
        const textContent = exportAsText(filteredSessions, patientName, therapistName)
        downloadText(textContent, `${patientName}-notes.txt`)
      }

      // Close modal after successful export
      setTimeout(() => {
        setIsExporting(false)
        onClose()
      }, 500)
    } catch (err) {
      setError(err.message || 'Failed to export notes. Please try again.')
      setIsExporting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full mx-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-gray-900">Export Notes</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors p-1 rounded-lg hover:bg-gray-100"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Export Format */}
        <div className="mb-6">
          <label className="block text-sm font-semibold text-gray-700 mb-3">Format</label>
          <div className="space-y-2">
            <label className="flex items-center p-3 border border-gray-200 rounded-xl cursor-pointer hover:bg-brand-50 transition-colors" style={{ borderColor: exportFormat === 'pdf' ? '#6047EE' : '#e5e7eb', backgroundColor: exportFormat === 'pdf' ? '#f5f3ff' : 'transparent' }}>
              <input
                type="radio"
                name="format"
                value="pdf"
                checked={exportFormat === 'pdf'}
                onChange={e => setExportFormat(e.target.value)}
                className="w-4 h-4"
              />
              <span className="ml-3 text-sm font-medium text-gray-900">PDF (Best for printing)</span>
            </label>
            <label className="flex items-center p-3 border border-gray-200 rounded-xl cursor-pointer hover:bg-brand-50 transition-colors" style={{ borderColor: exportFormat === 'text' ? '#6047EE' : '#e5e7eb', backgroundColor: exportFormat === 'text' ? '#f5f3ff' : 'transparent' }}>
              <input
                type="radio"
                name="format"
                value="text"
                checked={exportFormat === 'text'}
                onChange={e => setExportFormat(e.target.value)}
                className="w-4 h-4"
              />
              <span className="ml-3 text-sm font-medium text-gray-900">Plain Text</span>
            </label>
          </div>
        </div>

        {/* Date Range */}
        <div className="mb-6">
          <label className="block text-sm font-semibold text-gray-700 mb-3">Date Range</label>
          <div className="space-y-2">
            <label className="flex items-center p-3 border border-gray-200 rounded-xl cursor-pointer hover:bg-gray-50 transition-colors" style={{ borderColor: dateRange === 'all' ? '#6047EE' : '#e5e7eb', backgroundColor: dateRange === 'all' ? '#f5f3ff' : 'transparent' }}>
              <input
                type="radio"
                name="dateRange"
                value="all"
                checked={dateRange === 'all'}
                onChange={e => setDateRange(e.target.value)}
                className="w-4 h-4"
              />
              <span className="ml-3 text-sm font-medium text-gray-900">All sessions</span>
            </label>
            <label className="flex items-center p-3 border border-gray-200 rounded-xl cursor-pointer hover:bg-gray-50 transition-colors" style={{ borderColor: dateRange === 'year' ? '#6047EE' : '#e5e7eb', backgroundColor: dateRange === 'year' ? '#f5f3ff' : 'transparent' }}>
              <input
                type="radio"
                name="dateRange"
                value="year"
                checked={dateRange === 'year'}
                onChange={e => setDateRange(e.target.value)}
                className="w-4 h-4"
              />
              <span className="ml-3 text-sm font-medium text-gray-900">Last 12 months</span>
            </label>
            <label className="flex items-center p-3 border border-gray-200 rounded-xl cursor-pointer hover:bg-gray-50 transition-colors" style={{ borderColor: dateRange === 'custom' ? '#6047EE' : '#e5e7eb', backgroundColor: dateRange === 'custom' ? '#f5f3ff' : 'transparent' }}>
              <input
                type="radio"
                name="dateRange"
                value="custom"
                checked={dateRange === 'custom'}
                onChange={e => setDateRange(e.target.value)}
                className="w-4 h-4"
              />
              <span className="ml-3 text-sm font-medium text-gray-900">Custom date range</span>
            </label>
          </div>

          {/* Custom Date Range Inputs */}
          {dateRange === 'custom' && (
            <div className="mt-4 space-y-3">
              <label className="block">
                <span className="block text-xs font-semibold text-gray-700 mb-1">Start date</span>
                <input
                  type="date"
                  value={customStartDate}
                  onChange={e => setCustomStartDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  aria-label="Custom range start date"
                />
              </label>
              <label className="block">
                <span className="block text-xs font-semibold text-gray-700 mb-1">End date</span>
                <input
                  type="date"
                  value={customEndDate}
                  onChange={e => setCustomEndDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  aria-label="Custom range end date"
                />
              </label>
            </div>
          )}
        </div>

        {/* Session Count */}
        <div className="mb-6 p-4 bg-gray-50 rounded-xl">
          <p className="text-sm text-gray-600">
            <strong className="text-gray-900">{filteredSessions.length}</strong> session{filteredSessions.length !== 1 ? 's' : ''} will be exported
          </p>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-6 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 border border-gray-300 text-gray-700 font-medium rounded-xl hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleExport}
            disabled={isExporting || filteredSessions.length === 0}
            className="flex-1 px-4 py-2.5 bg-brand-600 hover:bg-brand-700 disabled:bg-gray-300 text-white font-medium rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            {isExporting ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Exporting...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 16v-4m0-4v.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Export
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
