import json
T='\t'
def tbl(name, cols=(), measures=(), partition=None, calc_partition=None, hidden=False):
    q=lambda n: f"'{n}'" if any(c in n for c in " -%[]") else n
    L=[f"table {q(name)}"]
    if hidden: L.append(T+"isHidden")
    L.append("")
    for (mn,expr,fmt,folder) in measures:
        if '\n' in expr:
            L.append(f"{T}measure {q(mn)} =")
            for ln in expr.split('\n'): L.append(T*3+ln)
        else:
            L.append(f"{T}measure {q(mn)} = {expr}")
        if fmt: L.append(f"{T*2}formatString: {fmt}")
        if folder: L.append(f"{T*2}displayFolder: {folder}")
        L.append("")
    for c in cols:
        cn,dt=c[0],c[1]
        if len(c)>2 and c[2]:
            L.append(f"{T}column {q(cn)} = {c[2]}")
            L.append(f"{T*2}dataType: {dt}")
        else:
            L.append(f"{T}column {q(cn)}")
            L.append(f"{T*2}dataType: {dt}")
            L.append(f"{T*2}sourceColumn: {cn}")
        if len(c)>3 and c[3]: L.append(T*2+"isHidden")
        L.append("")
    if partition:
        L.append(f"{T}partition {q(name)} = m")
        L.append(f"{T*2}mode: import")
        L.append(f"{T*2}source =")
        for ln in partition.split('\n'): L.append(T*4+ln)
    if calc_partition:
        L.append(f"{T}partition {q(name)} = calculated")
        L.append(f"{T*2}mode: import")
        L.append(f"{T*2}source = {calc_partition}")
    return '\n'.join(L)+'\n'

def sql(item, schema="dw"):
    return f'let\n    Source = Sql.Database(#"Server", #"Database"),\n    Data = Source{{[Schema="{schema}",Item="{item}"]}}[Data]\nin\n    Data'

M='Northwind Coffee.SemanticModel/definition/'
files={}
files[M+'database.tmdl']="database\n\tcompatibilityLevel: 1601\n"
files[M+'model.tmdl']="model Model\n\tculture: en-GB\n"
files[M+'expressions.tmdl']=('expression Server = "sql-demo.example.net" meta [IsParameterQuery=true, Type="Text", IsParameterQueryRequired=true]\n\tkind: m\n\n'
                             'expression Database = "CoffeeDW" meta [IsParameterQuery=true, Type="Text", IsParameterQueryRequired=true]\n\tkind: m\n')
files[M+'tables/Sales.tmdl']=tbl('Sales',
  cols=[('OrderID','string'),('DateKey','int64',None,True),('ShipDateKey','int64',None,True),('ProductKey','int64',None,True),
        ('StoreKey','int64',None,True),('CustomerKey','int64',None,True),('Quantity','int64'),('Amount','decimal'),('Cost','decimal'),
        ('Line Margin','decimal','Sales[Amount] - Sales[Cost]')],
  measures=[('Total Sales','SUM(Sales[Amount])','£#,0','Revenue'),
            ('Total Cost','SUM(Sales[Cost])','£#,0','Revenue'),
            ('Gross Margin','[Total Sales] - [Total Cost]','£#,0','Margin'),
            ('Gross Margin %','DIVIDE([Gross Margin], [Total Sales])','0.0%','Margin'),
            ('Units Sold','SUM(Sales[Quantity])','#,0','Volume'),
            ('Orders','DISTINCTCOUNT(Sales[OrderID])','#,0','Volume'),
            ('Avg Order Value','DIVIDE([Total Sales], [Orders])','£#,0.00','Revenue'),
            ('Sales LY','CALCULATE([Total Sales], SAMEPERIODLASTYEAR(\'Date\'[Date]))','£#,0','Time intelligence'),
            ('Sales YoY %','DIVIDE([Total Sales] - [Sales LY], [Sales LY])','0.0%','Time intelligence'),
            ('Sales by Ship Date','CALCULATE([Total Sales], USERELATIONSHIP(Sales[ShipDateKey], \'Date\'[DateKey]))','£#,0','Revenue'),
            ('Margin % (old)','DIVIDE([Total Sales] - [Cost Old], [Total Sales])','0.0%','Deprecated'),
            ('Margin Flag','IF([Margin % (old)] < 0.3, "Review", "OK")',None,'Deprecated')],
  partition=sql('FactSales'))
files[M+'tables/Budget.tmdl']=tbl('Budget',
  cols=[('DateKey','int64',None,True),('StoreKey','int64',None,True),('Budget Amount','decimal')],
  measures=[('Total Budget',"SUM(Budget[Budget Amount])",'£#,0','Budget'),
            ('Variance to Budget','[Total Sales] - [Total Budget]','£#,0','Budget'),
            ('Variance %','DIVIDE([Variance to Budget], [Total Budget])','0.0%','Budget')],
  partition=sql('FactBudget'))
files[M+'tables/Date.tmdl']=tbl('Date',
  cols=[('DateKey','int64',None,True),('Date','dateTime'),('Year','int64'),('Month','string'),('Month Number','int64',None,True),('Fiscal Year','string')],
  partition=sql('DimDate'))
files[M+'tables/Product.tmdl']=tbl('Product',
  cols=[('ProductKey','int64',None,True),('Product','string'),('Category','string'),('Roast','string'),('List Price','decimal')],
  partition=sql('DimProduct'))
files[M+'tables/Store.tmdl']=tbl('Store',
  cols=[('StoreKey','int64',None,True),('RegionKey','int64',None,True),('Store','string'),('Format','string'),('Opened','dateTime')],
  partition=sql('DimStore'))
files[M+'tables/Region.tmdl']=tbl('Region',
  cols=[('RegionKey','int64',None,True),('Region','string'),('Country','string')],
  partition=sql('DimRegion'))
files[M+'tables/Customer.tmdl']=tbl('Customer',
  cols=[('CustomerKey','int64',None,True),('Customer','string'),('Segment','string'),('Loyalty Tier','string')],
  partition=sql('DimCustomer'))
files[M+'tables/Targets.tmdl']=tbl('Targets',
  cols=[('Metric','string'),('Target','decimal')],
  partition='let\n    Source = Excel.Workbook(File.Contents("C:\\\\Data\\\\targets.xlsx"), null, true),\n    Sheet = Source{[Item="Targets",Kind="Sheet"]}[Data]\nin\n    Sheet')
files[M+'tables/Report Measures.tmdl']=tbl('Report Measures',
  cols=[('Value','string',None,True)],
  measures=[('Headline','"Sales " & FORMAT([Total Sales], "£#,0") & " (" & FORMAT([Sales YoY %], "+0.0%;-0.0%") & " YoY)"',None,None),
            ('Stores Trading','COUNTROWS(FILTER(VALUES(Store[Store]), [Total Sales] > 0))','#,0',None),
            ('Unused Draft','[Units Sold] * 2','#,0',None)],
  calc_partition='{ BLANK() }')
rels=[('Sales.DateKey','Date.DateKey',True),('Sales.ShipDateKey','Date.DateKey',False),('Sales.ProductKey','Product.ProductKey',True),
      ('Sales.StoreKey','Store.StoreKey',True),('Sales.CustomerKey','Customer.CustomerKey',True),
      ('Budget.DateKey','Date.DateKey',True),('Budget.StoreKey','Store.StoreKey',True),('Store.RegionKey','Region.RegionKey',True)]
R=[]
for i,(f,t,a) in enumerate(rels):
    R.append(f"relationship r{i+1}\n"+("\tisActive: false\n" if not a else "")+f"\tfromColumn: {f}\n\ttoColumn: {t}\n")
files[M+'relationships.tmdl']='\n'.join(R)

# ---- report (PBIR) ----
P='Northwind Coffee.Report/definition/pages/'
def proj(kind,ent,prop):
    key='Measure' if kind=='m' else 'Column'
    return {"field":{key:{"Expression":{"SourceRef":{"Entity":ent}},"Property":prop}},"queryRef":f"{ent}.{prop}"}
def vis(name,vt,x,y,w,h,roles,title=None):
    v={"visualType":vt,"query":{"queryState":{r:{"projections":[proj(*p) for p in ps]} for r,ps in roles.items()}}}
    if title: v["objects"]={"title":[{"properties":{"text":{"expr":{"Literal":{"Value":f"'{title}'"}}}}}]}
    return {"name":name,"position":{"x":x,"y":y,"z":0,"width":w,"height":h},"visual":v}
pages={'overview':('Overview',[
  vis('v1','card',20,20,290,120,{'Values':[('m','Sales','Total Sales')]}),
  vis('v2','card',330,20,290,120,{'Values':[('m','Sales','Gross Margin %')]}),
  vis('v3','card',640,20,290,120,{'Values':[('m','Sales','Sales YoY %')]}),
  vis('v4','card',950,20,310,120,{'Values':[('m','Budget','Variance %')]}),
  vis('v5','lineChart',20,160,780,300,{'Category':[('c','Date','Month')],'Y':[('m','Sales','Total Sales'),('m','Sales','Sales LY')]},'Sales vs last year'),
  vis('v6','clusteredBarChart',820,160,440,300,{'Category':[('c','Region','Region')],'Y':[('m','Budget','Variance to Budget')]},'Variance by region'),
  vis('v7','slicer',20,480,300,220,{'Values':[('c','Date','Fiscal Year')]}),
  vis('v8','tableEx',340,480,920,220,{'Values':[('c','Product','Product'),('m','Sales','Units Sold'),('m','Sales','Avg Order Value'),('m','Sales','Margin Flag')]},'Product detail')]),
 'stores':('Stores',[
  vis('s1','card',20,20,400,120,{'Values':[('m','Report Measures','Stores Trading')]}),
  vis('s2','tableEx',20,160,1240,540,{'Values':[('c','Store','Store'),('c','Store','Format'),('m','Sales','Total Sales'),('m','Sales','Orders'),('m','Sales','Sales by Ship Date')]},'Store league table')])}
files[P+'pages.json']=json.dumps({"pageOrder":list(pages.keys())},indent=2)
for pid,(pname,vs) in pages.items():
    files[P+f'{pid}/page.json']=json.dumps({"name":pid,"displayName":pname,"width":1280,"height":720},indent=2)
    for v in vs: files[P+f'{pid}/visuals/{v["name"]}/visual.json']=json.dumps(v,indent=2)

arr=[{"path":k,"text":v} for k,v in files.items()]
js="/* Synthetic demo PBIP project — 'Northwind Coffee'. Invented data, no real model content.\n   Generated by tools/gen_demo.py; edit that, not this file. */\n'use strict';\nwindow.PBIP_DEMO="+json.dumps(arr,indent=1,ensure_ascii=False)+";\n"
open('src/js/demo-model.js','w').write(js)
# also emit the raw TMDL for the tests
open('tests/demo-files.json','w').write(json.dumps(arr))
print(len(arr),'files')
