# PICDB

This is a database of neonatal and pediatric patients admitted to intensive care units located in China.

The data has been de-identified to protect patient privacy.

Files are distributed as compressed CSV files using gzip. Most *nix based platforms can decompress these files using the command line utility gzip. Software such as 7zip is available for other users (Windows, etc).

# Usage

PICDB is most easily investigated using a relational database management system (RDMS). We have provided scripts to load PICDB into MySQL and PostgreSQL, two popular distributions of RDMS.
To use these scripts, first install the RDMS of choice, then run each script in order, ensuring the data files are in the same folder as the scripts.