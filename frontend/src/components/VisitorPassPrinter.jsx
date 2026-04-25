import React, { useCallback, useEffect, useState } from "react";
import { Printer, X, Loader2, RefreshCcw } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { invoke } from "@tauri-apps/api/core";
import html2canvas from "html2canvas";
import { useToast } from "./toast/ToastProvider";

export const VisitorPassPrinter = ({ visitorData, onClose }) => {
    const printMode = "silent";
    const [isPrinting, setIsPrinting] = useState(false);
    const [isLoadingPrinters, setIsLoadingPrinters] = useState(true);
    const [printers, setPrinters] = useState([]);
    const [selectedPrinter, setSelectedPrinter] = useState("");
    const { showSuccess, showError } = useToast();
    const preferredPrinterStorageKey = "smart_gate_preferred_printer";

    const getQRCodeDataURL = useCallback(() => {
        const svgElement = document.getElementById("visitor-pass-qr-source");
        if (!svgElement) return "";

        const svgData = new XMLSerializer().serializeToString(svgElement);
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        const img = new Image();

        canvas.width = 320;
        canvas.height = 320;

        return new Promise((resolve) => {
            img.onload = () => {
                ctx.fillStyle = "#FFFFFF";
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL("image/png"));
            };
            img.onerror = () => resolve("");
            img.src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svgData)));
        });
    }, []);

    const escapeHtml = useCallback((value) => {
        return String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#39;");
    }, []);

    const normalizeVisitorPayload = useCallback(() => {
        const visitorName = String(visitorData?.name ?? visitorData?.visitor_name ?? "").trim();
        const visitorId = String(visitorData?.id ?? visitorData?.visitor_id ?? "").trim().toUpperCase();
        const purpose = String(visitorData?.purpose ?? "General Visit").trim();
        const personToVisit = String(visitorData?.person_to_visit ?? "N/A").trim();
        return { visitorName, visitorId, purpose, personToVisit };
    }, [visitorData]);

    const { visitorName, visitorId, purpose, personToVisit } = normalizeVisitorPayload();

    const getReceiptStyles = useCallback(() => `
    @page { margin: 0; }
    html, body {
      margin: 0;
      width: 58mm;
      background: #FFFFFF;
      color: #000000;
      font-family: Inter, Arial, Helvetica, sans-serif;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    body {
      padding: 4px;
      box-sizing: border-box;
    }
    .receipt {
      box-sizing: border-box;
      width: 58mm;
      padding: 0 0 5mm 0;
      text-align: center;
      background: #FFFFFF;
    }
    .header { font-size: 10pt; font-weight: 700; line-height: 1.15; margin: 0; color: #000000; }
    .pass-label { font-size: 9pt; font-weight: 700; margin: 1.5mm 0 0.8mm; color: #000000; }
    .separator {
      margin: 0 0 1.6mm;
      font-size: 9pt;
      font-weight: 700;
      letter-spacing: 0;
      color: #000000;
      line-height: 1;
    }
    .separator-bottom { margin: 0 0 0.8mm; }
    .greeting { font-size: 10pt; font-weight: 700; line-height: 1.15; margin: 0 0 1.4mm; color: #000000; }
    .visitor-id { font-size: 12pt; font-weight: 800; line-height: 1.1; margin: 0 0 1.8mm; color: #000000; }
    .instruction { font-size: 9pt; line-height: 1.2; margin: 0; color: #000000; }
    .qr-wrap { margin: 2.2mm 0 0; }
    .qr {
      width: 40mm;
      height: 40mm;
      object-fit: contain;
      image-rendering: pixelated;
      display: block;
      margin: 0 auto;
      background: #FFFFFF;
    }
    .valid { font-size: 9pt; font-weight: 700; line-height: 1.15; margin: 0 0 0.8mm; color: #000000; }
    .footer { font-size: 9pt; font-weight: 700; line-height: 1.1; margin: 0; color: #000000; }
  `, []);

    const getReceiptBodyHtml = useCallback((vName, vId, qrDataUrl) => `
  <div class="receipt">
    <div class="header">PAMANTASAN NG LUNGSOD NG PASIG</div>
    <div class="pass-label">Smart Gate - Visitor Pass</div>
    <div class="separator separator-bottom">--------------------------------</div>
    <div class="greeting">Welcome, ${vName}!</div>
    <div class="visitor-id">${vId}</div>
    <div class="instruction">Present this QR code at the scanner upon exit. A digital copy has been delivered to your email for your convenience.</div>
    <div class="qr-wrap">${qrDataUrl ? `<img class="qr" src="${qrDataUrl}" alt="Visitor QR" />` : ""}</div>
    <div class="valid">This pass is valid for today ONLY and will expire at 11:59 PM.</div>
    <div class="separator">--------------------------------</div>
    <div class="footer">Thank you for your visit!</div>
  </div>
`, []);

    const openPrintWindowReceipt = useCallback(async () => {
        const qrDataUrl = await getQRCodeDataURL();
        const vName = escapeHtml(visitorName);
        const vId = escapeHtml(visitorId);

        const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Visitor Pass</title>
  <style>${getReceiptStyles()}</style>
</head>
<body>${getReceiptBodyHtml(vName, vId, qrDataUrl)}</body>
</html>`;

        const printWindow = window.open("", "_blank", "width=460,height=760");
        if (printWindow) {
            printWindow.document.open();
            printWindow.document.write(html);
            printWindow.document.close();
            printWindow.focus();
            setTimeout(() => {
                try {
                    printWindow.print();
                } catch (_) {
                    // no-op
                }
            }, 200);
            return;
        }

        const iframe = document.createElement("iframe");
        iframe.setAttribute("aria-hidden", "true");
        iframe.style.position = "fixed";
        iframe.style.right = "0";
        iframe.style.bottom = "0";
        iframe.style.width = "0";
        iframe.style.height = "0";
        iframe.style.border = "0";
        iframe.style.opacity = "0";
        iframe.style.pointerEvents = "none";
        document.body.appendChild(iframe);

        const frameWindow = iframe.contentWindow;
        const frameDocument = frameWindow?.document;
        if (!frameWindow || !frameDocument) {
            document.body.removeChild(iframe);
            throw new Error("Unable to initialize print frame.");
        }

        frameDocument.open();
        frameDocument.write(html);
        frameDocument.close();

        setTimeout(() => {
            try {
                frameWindow.focus();
                frameWindow.print();
            } finally {
                setTimeout(() => {
                    if (iframe.parentNode) {
                        iframe.parentNode.removeChild(iframe);
                    }
                }, 1500);
            }
        }, 200);
    }, [escapeHtml, getQRCodeDataURL, getReceiptBodyHtml, getReceiptStyles, visitorName, visitorId]);

    const captureReceiptImageDataUrl = useCallback(async () => {
        const qrDataUrl = await getQRCodeDataURL();
        const vName = escapeHtml(visitorName);
        const vId = escapeHtml(visitorId);

        const container = document.createElement("div");
        container.setAttribute("aria-hidden", "true");
        container.style.position = "fixed";
        container.style.left = "-10000px";
        container.style.top = "0";
        container.style.width = "58mm";
        container.style.background = "#FFFFFF";
        container.style.zIndex = "-1";
        container.innerHTML = `<style>${getReceiptStyles()}</style>${getReceiptBodyHtml(vName, vId, qrDataUrl)}`;

        document.body.appendChild(container);
        const receiptElement = container.querySelector(".receipt");
        if (!receiptElement) {
            document.body.removeChild(container);
            throw new Error("Unable to prepare receipt image.");
        }

        try {
            const canvas = await html2canvas(receiptElement, {
                backgroundColor: "#FFFFFF",
                scale: 3,
                useCORS: true,
                logging: false,
            });
            return canvas.toDataURL("image/png");
        } finally {
            if (container.parentNode) {
                container.parentNode.removeChild(container);
            }
        }
    }, [escapeHtml, getQRCodeDataURL, getReceiptBodyHtml, getReceiptStyles, visitorName, visitorId]);

    const handlePrint = useCallback(async () => {
        setIsPrinting(true);
        try {
            if (!visitorName || !visitorId) {
                showError("Missing visitor details. Please retry registration before printing.");
                return;
            }

            if (printMode === "silent") {
                if (!selectedPrinter) {
                    showError("Please select a printer first.");
                    return;
                }

                const receiptImageDataUrl = await captureReceiptImageDataUrl();
                await invoke("print_receipt_image_silent", {
                    printerName: selectedPrinter,
                    receiptImageDataUrl,
                });
            } else {
                await openPrintWindowReceipt();
            }

            showSuccess("Print Job Sent: Visitor Pass ready.");
            onClose();
        } catch (error) {
            console.error("Print error:", error);
            showError(
                printMode === "silent"
                    ? "Printer Error: Please check printer connection and try again."
                    : "Unable to open print dialog."
            );
        } finally {
            setIsPrinting(false);
        }
    }, [
        captureReceiptImageDataUrl,
        selectedPrinter,
        showSuccess,
        showError,
        onClose,
        openPrintWindowReceipt,
        printMode,
        visitorName,
        visitorId,
    ]);

    const loadPrinters = useCallback(async () => {
        setIsLoadingPrinters(true);
        try {
            const availablePrinters = await invoke("get_available_printers");
            const safePrinters = Array.isArray(availablePrinters) ? availablePrinters : [];
            setPrinters(safePrinters);

            if (!safePrinters.length) {
                setSelectedPrinter("");
                showError("No printers detected. Please check printer connection.");
                return;
            }

            const savedPrinter = window.localStorage.getItem(preferredPrinterStorageKey);
            const fromSaved = safePrinters.find((printer) => printer.name === savedPrinter);
            const defaultPrinter = safePrinters.find((printer) => printer.is_default);
            const selected = fromSaved?.name || defaultPrinter?.name || safePrinters[0].name;

            setSelectedPrinter(selected);
            window.localStorage.setItem(preferredPrinterStorageKey, selected);
        } catch (error) {
            console.error("Failed to load printers:", error);
            setPrinters([]);
            setSelectedPrinter("");
            showError(typeof error === "string" ? error : "Failed to load printers.");
        } finally {
            setIsLoadingPrinters(false);
        }
    }, [showError]);

    useEffect(() => {
        if (printMode === "silent") {
            loadPrinters();
            return;
        }
        setIsLoadingPrinters(false);
        setPrinters([]);
        setSelectedPrinter("");
    }, [loadPrinters, printMode]);

    return (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-md p-4">
            <div style={{ position: "absolute", left: "-9999px", top: "-9999px" }}>
                <QRCodeSVG
                    id="visitor-pass-qr-source"
                    value={visitorId || ""}
                    size={512}
                    level="M"
                    includeMargin={false}
                    bgColor="#FFFFFF"
                    fgColor="#000000"
                />
            </div>

            <div className="bg-black/90 backdrop-blur-2xl border border-white/20 rounded-3xl shadow-2xl w-full max-w-4xl overflow-hidden animate-in zoom-in-95 fade-in duration-200">
                <div className="grid grid-cols-1 md:grid-cols-2">
                    {/* Left Side: Visitor Digital Pass */}
                    <div className="p-8 border-b md:border-b-0 md:border-r border-white/10 bg-white/5">
                        <div className="flex flex-col items-center">
                            <div className="w-full text-center mb-6">
                                <h3 className="text-blue-400 text-xs font-bold uppercase tracking-[0.3em] mb-1">Visitor Pass</h3>
                                <div className="h-px w-12 bg-blue-500/50 mx-auto"></div>
                            </div>

                            <div className="bg-white p-4 rounded-2xl shadow-xl mb-6 transform hover:scale-105 transition-transform duration-300">
                                <QRCodeSVG
                                    value={visitorId || ""}
                                    size={180}
                                    level="H"
                                    includeMargin={false}
                                    bgColor="#FFFFFF"
                                    fgColor="#000000"
                                />
                            </div>

                            <div className="w-full space-y-4">
                                <div className="text-center">
                                    <p className="text-white font-bold text-2xl uppercase tracking-tight">{visitorName}</p>
                                    <p className="text-blue-400 font-mono text-lg tracking-[0.2em] font-medium mt-1">{visitorId}</p>
                                </div>

                                <div className="grid grid-cols-2 gap-4 mt-6">
                                    <div className="bg-white/5 p-3 rounded-xl border border-white/10">
                                        <p className="text-[10px] uppercase tracking-wider text-white/40 mb-1">Purpose of Visit</p>
                                        <p className="text-white text-sm font-medium line-clamp-2">{purpose}</p>
                                    </div>
                                    <div className="bg-white/5 p-3 rounded-xl border border-white/10">
                                        <p className="text-[10px] uppercase tracking-wider text-white/40 mb-1">Person to Visit</p>
                                        <p className="text-white text-sm font-medium line-clamp-2">{personToVisit}</p>
                                    </div>
                                </div>

                                <div className="flex items-center gap-2 justify-center py-2 px-4 rounded-full bg-blue-500/10 text-blue-400 text-[10px] font-bold uppercase tracking-widest border border-blue-500/20">
                                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></span>
                                    Valid for Today Only
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Right Side: Printing Interaction */}
                    <div className="p-8 flex flex-col justify-center items-center text-center">
                        <div className="w-16 h-16 bg-blue-500/15 rounded-full flex items-center justify-center border-2 border-blue-500/30 mb-6">
                            <Printer className="w-8 h-8 text-blue-400" />
                        </div>
                        
                        <h2 className="text-2xl font-bold text-white tracking-wide mb-2">Print Physical Pass?</h2>
                        <p className="text-white/60 mb-8 text-sm max-w-[280px]">
                            Would you like to print a 58mm thermal receipt for this visitor?
                        </p>

                        {printMode === "silent" ? (
                            <div className="w-full mb-8 space-y-2 text-left">
                                <div className="flex items-center justify-between px-1">
                                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/40">Select Printer</p>
                                    <button
                                        type="button"
                                        onClick={loadPrinters}
                                        disabled={isLoadingPrinters || isPrinting}
                                        className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-0.5 text-[10px] text-white/50 transition-colors hover:bg-white/5 hover:text-white disabled:cursor-not-allowed"
                                    >
                                        <RefreshCcw className={`h-2.5 w-2.5 ${isLoadingPrinters ? "animate-spin" : ""}`} />
                                        Refresh
                                    </button>
                                </div>
                                <select
                                    value={selectedPrinter}
                                    onChange={(event) => {
                                        const nextPrinter = event.target.value;
                                        setSelectedPrinter(nextPrinter);
                                        window.localStorage.setItem(preferredPrinterStorageKey, nextPrinter);
                                    }}
                                    disabled={isLoadingPrinters || isPrinting || !printers.length}
                                    className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none transition focus:ring-2 focus:ring-blue-500/40 disabled:cursor-not-allowed disabled:opacity-50 appearance-none"
                                >
                                    {isLoadingPrinters && <option value="">Loading printers...</option>}
                                    {!isLoadingPrinters && !printers.length && <option value="">No printers found</option>}
                                    {!isLoadingPrinters && printers.map((printer) => (
                                        <option key={printer.name} value={printer.name} className="bg-slate-900 text-white">
                                            {printer.name}{printer.is_default ? " (Default)" : ""}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        ) : (
                            <div className="w-full mb-8 rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-left">
                                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/60">Print Mode</p>
                                <p className="mt-1 text-sm text-white/80">Window preview mode is enabled for receipt size checking.</p>
                            </div>
                        )}

                        <div className="flex gap-4 w-full">
                            <button
                                onClick={onClose}
                                disabled={isPrinting}
                                className="flex-1 px-4 py-3.5 bg-white/5 border border-white/10 text-white/80 font-medium rounded-xl hover:bg-white/10 hover:text-white transition-all focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 text-sm"
                            >
                                <X className="w-4 h-4 inline mr-2" />
                                Done
                            </button>
                            <button
                                onClick={handlePrint}
                                disabled={isPrinting || (printMode === "silent" && (isLoadingPrinters || !selectedPrinter))}
                                className="flex-[1.5] px-4 py-3.5 bg-blue-500 hover:bg-blue-400 text-white font-bold rounded-xl transition-all focus:outline-none focus:ring-4 focus:ring-blue-500/30 flex items-center justify-center gap-2.5 text-base shadow-[0_0_20px_rgba(59,130,246,0.3)] hover:shadow-[0_0_30px_rgba(59,130,246,0.5)] disabled:cursor-not-allowed disabled:opacity-70"
                            >
                                {isPrinting ? (
                                    <>
                                        <Loader2 className="w-5 h-5 animate-spin" />
                                        Printing...
                                    </>
                                ) : (
                                    <>
                                        <Printer className="w-5 h-5" />
                                        Print Pass
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

