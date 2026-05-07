import React from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';

export const Pagination = ({
    currentPage,
    totalPages,
    onPageChange,
    totalItems,
    itemsPerPage,
    currentItemsCount
}) => {
    if (totalPages <= 1 && (!totalItems || totalItems === 0)) return null;

    const maxVisiblePages = 10;
    
    // Calculate sliding window
    let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
    let endPage = startPage + maxVisiblePages - 1;

    if (endPage > totalPages) {
        endPage = totalPages;
        startPage = Math.max(1, endPage - maxVisiblePages + 1);
    }

    const pages = [];
    for (let i = startPage; i <= endPage; i++) {
        pages.push(i);
    }

    const startItem = totalItems === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1;
    const endItem = startItem === 0 ? 0 : startItem + currentItemsCount - 1;

    return (
        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 text-xs font-semibold text-slate-500 flex flex-wrap items-center justify-between gap-3 shrink-0 rounded-b-xl">
            <div>
                {totalItems > 0 ? (
                    `Showing ${startItem}–${endItem} of ${totalItems}`
                ) : (
                    'No items to display'
                )}
            </div>
            {totalPages > 1 && (
                <div className="flex items-center gap-1">
                    <button
                        onClick={() => onPageChange(1)}
                        disabled={currentPage === 1}
                        title="First Page"
                        className="px-2 py-1 rounded border border-slate-200 bg-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors flex items-center gap-0.5"
                    >
                        <ChevronsLeft className="w-4 h-4" />
                    </button>
                    <button
                        onClick={() => onPageChange(Math.max(1, currentPage - 1))}
                        disabled={currentPage === 1}
                        title="Previous Page"
                        className="px-2 py-1 rounded border border-slate-200 bg-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors flex items-center gap-0.5"
                    >
                        <ChevronLeft className="w-4 h-4" /> Prev
                    </button>
                    
                    {pages.map((p) => (
                        <button
                            key={p}
                            onClick={() => onPageChange(p)}
                            className={`min-w-[28px] px-2 py-1 rounded border transition-colors ${currentPage === p
                                ? 'bg-slate-800 text-white border-slate-800'
                                : 'border-slate-200 bg-white hover:bg-slate-50'
                                }`}
                        >
                            {p}
                        </button>
                    ))}

                    <button
                        onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
                        disabled={currentPage === totalPages}
                        title="Next Page"
                        className="px-2 py-1 rounded border border-slate-200 bg-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors flex items-center gap-0.5"
                    >
                        Next <ChevronRight className="w-4 h-4" />
                    </button>
                    <button
                        onClick={() => onPageChange(totalPages)}
                        disabled={currentPage === totalPages}
                        title="Last Page"
                        className="px-2 py-1 rounded border border-slate-200 bg-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors flex items-center gap-0.5"
                    >
                        <ChevronsRight className="w-4 h-4" />
                    </button>
                </div>
            )}
        </div>
    );
};
