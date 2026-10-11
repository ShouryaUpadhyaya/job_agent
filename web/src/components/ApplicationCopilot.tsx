'use client';

import React, { useState } from 'react';

export default function ApplicationCopilot({ initialCoverLetter = '' }) {
  const [coverLetter, setCoverLetter] = useState(initialCoverLetter);
  const [editRequest, setEditRequest] = useState('');
  const [approved, setApproved] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleApproveSubmit = () => {
    if (approved) {
      setSubmitted(true);
    }
  };

  return (
    <div className="max-w-3xl mx-auto p-6 bg-white shadow-xl rounded-2xl border border-gray-100">
      <h2 className="text-2xl font-bold text-gray-800 mb-6">Application Review</h2>
      
      <div className="mb-6">
        <label className="block text-sm font-semibold text-gray-700 mb-2">Drafted Cover Letter</label>
        <textarea
          className="w-full h-48 p-4 border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all outline-none resize-none text-gray-700"
          value={coverLetter}
          onChange={(e) => setCoverLetter(e.target.value)}
          placeholder="Your cover letter draft..."
        />
      </div>

      <div className="mb-8">
        <label className="block text-sm font-semibold text-gray-700 mb-2">Request Edits</label>
        <textarea
          className="w-full h-24 p-4 border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all outline-none resize-none text-gray-700"
          value={editRequest}
          onChange={(e) => setEditRequest(e.target.value)}
          placeholder="E.g., Make it sound more enthusiastic..."
        />
        <div className="mt-3 flex justify-end">
          <button className="px-4 py-2 bg-gray-800 text-white font-medium rounded-lg hover:bg-gray-700 transition-colors">
            Ask Copilot to Edit
          </button>
        </div>
      </div>

      <div className="pt-6 border-t border-gray-100">
        <div className="flex items-center mb-4">
          <input
            type="checkbox"
            id="approve"
            className="w-5 h-5 text-blue-600 rounded border-gray-300 focus:ring-blue-500 cursor-pointer"
            checked={approved}
            onChange={(e) => setApproved(e.target.checked)}
          />
          <label htmlFor="approve" className="ml-3 text-gray-700 font-medium cursor-pointer">
            I approve this cover letter and application details
          </label>
        </div>
        
        <button
          onClick={handleApproveSubmit}
          disabled={!approved || submitted}
          className={`w-full py-3 px-4 rounded-xl font-bold text-lg transition-all ${
            approved && !submitted
              ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-md hover:shadow-lg'
              : 'bg-gray-200 text-gray-400 cursor-not-allowed'
          }`}
        >
          {submitted ? 'Submitted Successfully' : 'Approve and Submit'}
        </button>
      </div>
    </div>
  );
}
