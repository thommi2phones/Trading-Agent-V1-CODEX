"use client";

import { useCallback, useState } from "react";

interface Props {
  onImageSelected: (file: File) => void;
}

export default function ChartDropZone({ onImageSelected }: Props) {
  const [isDragging, setIsDragging] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  const handleFile = useCallback(
    (file: File) => {
      if (!file.type.startsWith("image/")) return;
      setPreview(URL.createObjectURL(file));
      onImageSelected(file);
    },
    [onImageSelected]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => setIsDragging(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  return (
    <div
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      className={`relative border-2 border-dashed rounded-xl transition-colors cursor-pointer ${
        isDragging
          ? "border-tv-blue bg-tv-blue/10"
          : "border-tv-border hover:border-tv-text-dim"
      } ${preview ? "p-2" : "p-8"}`}
    >
      <input
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        onChange={handleChange}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
      />

      {preview ? (
        <div className="relative">
          <img
            src={preview}
            alt="Chart preview"
            className="w-full rounded-lg max-h-96 object-contain bg-tv-bg"
          />
          <button
            onClick={(e) => {
              e.stopPropagation();
              setPreview(null);
            }}
            className="absolute top-2 right-2 w-6 h-6 rounded-full bg-tv-bg/80 text-tv-text-dim hover:text-tv-text flex items-center justify-center text-xs"
          >
            &times;
          </button>
        </div>
      ) : (
        <div className="text-center">
          <svg
            className="w-10 h-10 mx-auto text-tv-text-dim mb-3"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0 0 22.5 18.75V5.25A2.25 2.25 0 0 0 20.25 3H3.75A2.25 2.25 0 0 0 1.5 5.25v13.5A2.25 2.25 0 0 0 3.75 21Z"
            />
          </svg>
          <p className="text-sm text-tv-text-dim">
            Drop a chart screenshot or{" "}
            <span className="text-tv-blue">browse</span>
          </p>
          <p className="text-xs text-tv-text-dim mt-1">
            PNG, JPEG, WEBP supported
          </p>
        </div>
      )}
    </div>
  );
}
