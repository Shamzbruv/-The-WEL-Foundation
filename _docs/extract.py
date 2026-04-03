import sys
try:
    from pypdf import PdfReader
    reader = PdfReader('Revamp Research Report for The WEL Foundation Website.pdf')
    text = '\n'.join(page.extract_text() for page in reader.pages)
    with open('output.txt', 'w', encoding='utf-8') as f:
        f.write(text)
    print("Done")
except Exception as e:
    print(e)
