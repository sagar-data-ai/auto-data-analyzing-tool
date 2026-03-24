# 🚀 Auto Data Analyzer Tool

> ⚡ Analyze your dataset in seconds — no coding required!

Auto Data Analyzer Tool is a **React + Vite + Tailwind** based web application that allows users to upload datasets and instantly get:

📊 Deep insights  
📈 Interactive visualizations  
📄 Downloadable reports  

---

## 🎯 Purpose

This project is built as an **MVP (Minimum Viable Product)** to help users quickly understand datasets **without writing analysis code manually**.

## 🚀 **Live Demo**

- App: `https://auto-data-analyzing-tool.vercel.app/`
---

## ✨ Features

### 📂 File Upload Support
- CSV (`.csv`)
- Excel (`.xls`, `.xlsx`)
- Parquet (`.parquet`)

---

### 🧹 Automatic Data Cleaning
- Column name normalization  
- Duplicate row removal  
- Missing value handling  
- Numeric & date type conversion  

---

### 📊 Data Analysis
- Row & column summary  
- Data type classification:
  - Numeric
  - Categorical
  - Date  
- Missing value percentage  
- Unique value counts  
- Statistical metrics:
  - Mean
  - Median
  - Mode
  - Standard Deviation  
- Correlation matrix & pairs  

---

### 📈 Visualizations
- 📊 Histograms (numeric data)
- 📌 Bar & Pie charts (categorical data)
- 🔗 Scatter plots (numeric relationships)

---

### 🧠 Insights Engine
- Rule-based smart insights  
- Dominant categories detection  
- Strongest correlations  
- High variance signals  

---

### 📄 Report Export
- Download as **HTML**
- Download as **PDF**

---

## 🛠️ Tech Stack

| Category        | Tools Used |
|----------------|----------|
| ⚛️ Frontend     | React, Vite, TypeScript |
| 🎨 Styling      | Tailwind CSS |
| 📊 Charts       | Recharts |
| 📂 File Parsing | PapaParse, XLSX, hyparquet |
| 🎬 Animation    | Framer Motion |
| 📄 Reports      | jsPDF, jspdf-autotable |


## 📁 **Project Structure**

```text
src/
│
├── App.tsx        
├── main.tsx
├── index.css     
│
public/          
```

---

## 📌 How To Use

1. 🌐 Open the application in your browser  
2. 📂 Upload a dataset file:
3. ⏳ Wait for the system to process your data  
4. 📊 Explore the generated sections:
5. 📄 Download the final report:
   - HTML format  
   - PDF format  

---

## ⚠️ Notes

- ⏱️ Large datasets may take more time for processing and chart rendering  
- 📉 Scatter plots use sampling for better performance  
- 🧠 Insights are currently **rule-based** (not AI/LLM-powered yet)  

---

## ✨ Author

**Sagar Kumar** - [![LinkedIn](https://img.shields.io/badge/LinkedIn-%230077B5.svg?logo=linkedin&logoColor=white)](https://linkedin.com/in/sagar-datascience)   [![GitHub](https://img.shields.io/badge/GitHub-181717?logo=github&logoColor=white)](https://github.com/sagar-data-ai)  [![Portfolio](https://img.shields.io/badge/Portfolio-000000?logo=vercel&logoColor=white)](https://portfolio-sagar-v2.vercel.app)

## ⭐ Support

If you found this project useful:

- ⭐ Give it a star on GitHub  
- 📢 Share it with others  
- 💡 Contribute or suggest improvements  

---
## License

This project is open for personal and educational use.
